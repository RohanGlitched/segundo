import "server-only";
import { concat, createWalletClient, encodeFunctionData, http, maxUint256, parseAbi, parseAbiItem, parseEventLogs, type Address, type Hex, type TransactionReceipt } from "viem";
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
 *
 * Each swap carries the cash-out transfer's hash after its arguments (the pair ignores trailing calldata), so the
 * chain itself records which cash-out a swap settled. Before swapping, the partner's own swaps since that transfer
 * are read back, and a cash-out already settled from any server instance is answered with its swap, not swapped again.
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
/** `status` is the HTTP status for a cash-out that can't be settled (404 not on chain, 422 not one to settle). */
export type SettleResult = { settled: Settled } | { skipped: string; status?: number } | { error: string };

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
/** Blocks per log query on the public RPC. */
const SPAN = 100n;

/** The swap calldata for one cash-out: the pair's call, then the cash-out transfer's hash. */
export const taggedSwap = (call: Hex, transfer: Hex) => concat([call, transfer]);
/** True when a transaction's input is a swap tagged with this cash-out transfer. */
export const settles = (input: Hex, transfer: Hex) => input.length > 66 && input.slice(-64).toLowerCase() === transfer.slice(2).toLowerCase();

/** A receipt, asked again for a few seconds: a cash-out sent a moment ago may not be served by every node yet. */
async function receiptOf(hash: Hex, tries = 6): Promise<TransactionReceipt | null> {
  for (let i = 0; ; i++) {
    const r = await publicClient.getTransactionReceipt({ hash }).catch(() => null);
    if (r || i >= tries - 1) return r;
    await new Promise((ok) => setTimeout(ok, 500));
  }
}

/**
 * The partner's swap that already settled this cash-out, if one did: every AUSD transfer out of the partner from the
 * cash-out's block on, read back to its transaction and checked for this cash-out's tag.
 */
export async function settledBefore(partnerAddress: Address, transfer: Hex, fromBlock: bigint): Promise<Settled | null> {
  const head = await publicClient.getBlockNumber({ cacheTime: 0 });
  const ranges: [bigint, bigint][] = [];
  for (let a = fromBlock; a <= head; a += SPAN) ranges.push([a, a + SPAN - 1n > head ? head : a + SPAN - 1n]);
  const outs = new Map<Hex, bigint>();
  // A few ranges at a time: the public RPC allows about 50 calls a second.
  for (let i = 0; i < ranges.length; i += 5) {
    const logs = await Promise.all(
      ranges.slice(i, i + 5).map(([a, b]) => publicClient.getLogs({ address: DOLLAR, event: transferEvent, args: { from: partnerAddress }, fromBlock: a, toBlock: b })),
    );
    for (const l of logs.flat()) if (l.transactionHash) outs.set(l.transactionHash, (outs.get(l.transactionHash) ?? 0n) + (l.args.value ?? 0n));
  }
  for (const [hash, ausd] of outs) {
    const tx = await publicClient.getTransaction({ hash });
    if (tx.to?.toLowerCase() !== AGORA_PAIR.toLowerCase() || !settles(tx.input, transfer)) continue;
    const receipt = await publicClient.getTransactionReceipt({ hash });
    if (receipt.status !== "success") continue;
    const ctk = parseEventLogs({ abi: erc20, eventName: "Transfer", logs: receipt.logs.filter((l) => l.address.toLowerCase() === AGORA_CTK.toLowerCase()) })
      .filter((l) => l.args.to.toLowerCase() === partnerAddress.toLowerCase())
      .reduce((sum, l) => sum + l.args.value, 0n);
    return { hash, block: Number(receipt.blockNumber), ausd: ausd.toString(), ctk: ctk.toString(), capped: ausd >= SETTLE_CAP };
  }
  return null;
}

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
    // A failed swap may be asked for again, and so may a transfer not on chain yet; a done or skipped one is not redone.
    if ("error" in r || ("skipped" in r && r.status === 404)) seen.delete(id);
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

  const receipt = await receiptOf(transfer);
  if (!receipt) return { skipped: "That cash-out transfer isn't on chain.", status: 404 };
  if (receipt.status !== "success") return { skipped: "That cash-out transfer failed on chain.", status: 422 };
  const paid = parseEventLogs({ abi: erc20, eventName: "Transfer", logs: receipt.logs.filter((l) => l.address.toLowerCase() === DOLLAR.toLowerCase()) })
    .filter((l) => l.args.to.toLowerCase() === DEMO_PARTNER.toLowerCase())
    .reduce((sum, l) => sum + l.args.value, 0n);
  if (paid === 0n) return { skipped: "That transfer didn't pay the demo partner.", status: 422 };
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null);
  if (!block || Date.now() / 1000 - Number(block.timestamp) > MAX_AGE_S) return { skipped: "That cash-out is too old to settle.", status: 422 };

  const amountIn = paid > SETTLE_CAP ? SETTLE_CAP : paid;
  try {
    // Settled already, from this instance or another: answer with that swap.
    const before = await settledBefore(from, transfer, receipt.blockNumber);
    if (before) return { settled: before };
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
    const data = taggedSwap(encodeFunctionData({ abi: pairAbi, functionName: "swapExactTokensForTokens", args: [amountIn, out, [...PATH], from, deadline] }), transfer);
    // Simulate first so a revert explains itself instead of costing gas.
    await publicClient.call({ account: from, to: AGORA_PAIR, data });
    const landed = await sendAndWait(client, { to: AGORA_PAIR, data });
    return { settled: { hash: landed.hash, block: landed.block, ausd: amountIn.toString(), ctk: out.toString(), capped: paid > SETTLE_CAP } };
  } catch (e) {
    return { error: `Agora settlement didn't go through: ${revertReason(e)}` };
  }
}
