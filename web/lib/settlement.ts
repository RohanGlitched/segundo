import "server-only";
import { createWalletClient, encodeFunctionData, http, maxUint256, parseAbi, parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DOLLAR, RPC_URL, monadTestnet, publicClient } from "./chain";
import { revertReason, sendAndWait } from "./server";
import { AGORA_PAIR, DEMO_PARTNER } from "@/app/cashout/corridors";

/**
 * Agora Instant Settlement on Monad testnet: the partner leg of a cash-out.
 *
 * On mainnet a licensed partner takes the freelancer's AUSD and pays out pesos, naira or rupees from its own local
 * balance. On testnet that payout is mocked the way Agora's bounty asks: the demo partner, approved once through
 * Agora's testnet Whitelister (scripts/agora-settle.mjs), swaps the AUSD it just received for Agora's test token CTK
 * on Agora's AUSD/CTK Instant Settlement pair, at the pair's fixed price. The freelancer's cash-out has already
 * landed by then; this never touches their money, and a failure here only shows as a line on the receipt.
 */
export { AGORA_PAIR }; // token0 = CTK, token1 = AUSD
export const AGORA_FACTORY: Address = "0x8468587Af422ad440F58a57E955eCA6A970b5375";
export const AGORA_WHITELISTER: Address = "0x7c10F56d6f04a51376393a1C3670e966863F6BD5";
export const AGORA_CTK: Address = "0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D"; // 18 decimals

/** The most AUSD one cash-out settles through the pair: a hundred test dollars. */
export const SETTLE_CAP = 100_000_000n;
/** A transfer older than this is not settled, so old cash-outs can't be replayed into swaps. */
const MAX_AGE_S = 15 * 60;
/** Test MON the partner keeps back: below this it stops settling rather than strand a transaction. */
const PARTNER_GAS_FLOOR = 30_000_000_000_000_000n; // 0.03 MON

const pairAbi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])",
  "function hasRole(string role, address who) view returns (bool)",
]);
const erc20 = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
]);
const PATH = [DOLLAR, AGORA_CTK] as const;

export type Settled = { hash: Hex; block: number; ausd: string; ctk: string; capped: boolean };
export type SettleResult = { settled: Settled } | { skipped: string } | { error: string };

function partner() {
  let key = process.env.PARTNER_KEY?.trim().replace(/^["']|["']$/g, "");
  if (!key) return null;
  if (!key.startsWith("0x")) key = `0x${key}`;
  const account = privateKeyToAccount(key as Hex);
  if (account.address.toLowerCase() !== DEMO_PARTNER.toLowerCase()) return null;
  return createWalletClient({ account, chain: monadTestnet, transport: http(RPC_URL) });
}

export const settlementConfigured = () => !!process.env.PARTNER_KEY?.trim();

/** Transfers this instance has settled or is settling, so one cash-out is swapped once. */
const seen = new Map<string, Promise<SettleResult>>();

/** Swaps the AUSD a landed cash-out sent the partner (capped) for CTK through Agora's Instant Settlement pair. */
export function settleCashOut(transfer: Hex): Promise<SettleResult> {
  const id = transfer.toLowerCase();
  const prior = seen.get(id);
  if (prior) return prior;
  const run = settle(transfer).then((r) => {
    if ("error" in r) seen.delete(id); // a failed swap may be asked for again; a done or skipped one is not redone
    return r;
  });
  seen.set(id, run);
  if (seen.size > 5_000) seen.delete(seen.keys().next().value!);
  return run;
}

async function settle(transfer: Hex): Promise<SettleResult> {
  const client = partner();
  if (!client) return { skipped: "Agora settlement isn't switched on for this deployment." };
  const from = client.account.address;

  const receipt = await publicClient.getTransactionReceipt({ hash: transfer }).catch(() => null);
  if (!receipt || receipt.status !== "success") return { skipped: "That cash-out transfer isn't on chain." };
  const paid = parseEventLogs({ abi: erc20, eventName: "Transfer", logs: receipt.logs.filter((l) => l.address.toLowerCase() === DOLLAR.toLowerCase()) })
    .filter((l) => l.args.to.toLowerCase() === DEMO_PARTNER.toLowerCase())
    .reduce((sum, l) => sum + l.args.value, 0n);
  if (paid === 0n) return { skipped: "That transfer didn't pay the demo partner." };
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null);
  if (!block || Date.now() / 1000 - Number(block.timestamp) > MAX_AGE_S) return { skipped: "That cash-out is too old to settle." };

  const amountIn = paid > SETTLE_CAP ? SETTLE_CAP : paid;
  try {
    const [mon, held, allowance, approved] = await Promise.all([
      publicClient.getBalance({ address: from }),
      publicClient.readContract({ address: DOLLAR, abi: erc20, functionName: "balanceOf", args: [from] }),
      publicClient.readContract({ address: DOLLAR, abi: erc20, functionName: "allowance", args: [from, AGORA_PAIR] }),
      publicClient.readContract({ address: AGORA_PAIR, abi: pairAbi, functionName: "hasRole", args: ["APPROVED_SWAPPER", from] }),
    ]);
    if (mon < PARTNER_GAS_FLOOR) return { error: "The demo partner is out of test MON for the settlement swap." };
    if (!approved) return { error: "The demo partner isn't an approved swapper on Agora's pair yet." };
    if (held < amountIn) return { error: "The demo partner doesn't hold that much AUSD right now." };
    if (allowance < amountIn) {
      const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [AGORA_PAIR, maxUint256] });
      await sendAndWait(client, { to: DOLLAR, data });
    }
    const amounts = await publicClient.readContract({ address: AGORA_PAIR, abi: pairAbi, functionName: "getAmountsOut", args: [amountIn, [...PATH]] });
    const out = amounts[amounts.length - 1]!;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const data = encodeFunctionData({ abi: pairAbi, functionName: "swapExactTokensForTokens", args: [amountIn, out, [...PATH], from, deadline] });
    // Simulate first so a revert explains itself instead of costing gas.
    await publicClient.call({ account: from, to: AGORA_PAIR, data });
    const landed = await sendAndWait(client, { to: AGORA_PAIR, data });
    return { settled: { hash: landed.hash, block: landed.block, ausd: amountIn.toString(), ctk: out.toString(), capped: paid > SETTLE_CAP } };
  } catch (e) {
    return { error: `Agora settlement didn't go through: ${revertReason(e)}` };
  }
}
