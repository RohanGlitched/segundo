/**
 * Agora Instant Settlement on Monad testnet, for Segundo's demo payout partner (the wallet /cashout pays).
 *
 *   node scripts/agora-settle.mjs status          partner MON / AUSD / CTK, swapper role, pair state, a quote for 1 AUSD
 *   node scripts/agora-settle.mjs simulate [usd]  eth_call the whitelist (if needed) and a swap of `usd` AUSD (default 1)
 *   node scripts/agora-settle.mjs gas [mon=1]     the keeper sends the partner `mon` test MON, if it holds less than that
 *   node scripts/agora-settle.mjs whitelist       Whitelister.setApprovedSwapper(partner), once (permissionless on testnet)
 *   node scripts/agora-settle.mjs approve         lets the pair spend the partner's AUSD (max allowance, once)
 *   node scripts/agora-settle.mjs swap [usd=1]    swapExactTokensForTokens: `usd` AUSD in, CTK out, to the partner itself
 *   node scripts/agora-settle.mjs env             writes PARTNER_KEY into web/.env.local (so `next dev` settles cash-outs)
 *   node scripts/agora-settle.mjs value | vercel env add PARTNER_KEY production
 *                                                 hands the key to another program; refuses to write it to a terminal
 *
 * The web app does the same swap after every cash-out (web/lib/settlement.ts). The partner key is read in-process
 * from PARTNER_KEY or keys/partner.json and never printed. Testnet only. Run from the repository root.
 */
import fs from "node:fs";
import path from "node:path";
import { viem, accounts, pub, chain, envKey, ROOT, AUSD } from "./bench/lib.mjs";

export const PAIR = "0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae"; // AUSD/CTK, token0 = CTK, token1 = AUSD
export const WHITELISTER = "0x7c10F56d6f04a51376393a1C3670e966863F6BD5";
export const FACTORY = "0x8468587Af422ad440F58a57E955eCA6A970b5375";
export const CTK = "0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D";
const PARTNER = "0x092178787c772cbF67c2560B38D9F4f3454677e6";

const pairAbi = viem.parseAbi([
  "function hasRole(string role, address who) view returns (bool)",
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function reserve0() view returns (uint256)",
  "function reserve1() view returns (uint256)",
  "function isPaused() view returns (bool)",
  "function getPrice() view returns (uint256)",
]);
const whitelisterAbi = viem.parseAbi([
  "function setApprovedSwapper(address swapper)",
  "function isWhitelisterOfPair(address pair) view returns (bool)",
  "function factoryAddress() view returns (address)",
]);
const erc20 = viem.parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function transfer(address, uint256) returns (bool)",
]);

function partnerKey() {
  let k = process.env.PARTNER_KEY?.trim();
  if (!k) k = JSON.parse(fs.readFileSync(path.join(ROOT, "keys/partner.json"), "utf8")).key;
  if (!k.startsWith("0x")) k = "0x" + k;
  return k;
}
const account = accounts.privateKeyToAccount(partnerKey());
if (account.address.toLowerCase() !== PARTNER.toLowerCase()) throw new Error("keys/partner.json is not the demo partner wallet");
const wallet = viem.createWalletClient({ account, chain, transport: viem.http(chain.rpcUrls.default.http[0]) });
const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
const units = (usd) => viem.parseUnits(String(usd), 6);
const path2 = [AUSD, CTK];
const explorer = (h) => `https://testnet.monadvision.com/tx/${h}`;

async function status() {
  const [mon, ausd, ctk, role, allowance, t0, t1, r0, r1, paused, price, isW, factory] = await Promise.all([
    pub.getBalance({ address: PARTNER }),
    read(AUSD, erc20, "balanceOf", [PARTNER]),
    read(CTK, erc20, "balanceOf", [PARTNER]),
    read(PAIR, pairAbi, "hasRole", ["APPROVED_SWAPPER", PARTNER]),
    read(AUSD, erc20, "allowance", [PARTNER, PAIR]),
    read(PAIR, pairAbi, "token0"),
    read(PAIR, pairAbi, "token1"),
    read(PAIR, pairAbi, "reserve0"),
    read(PAIR, pairAbi, "reserve1"),
    read(PAIR, pairAbi, "isPaused"),
    read(PAIR, pairAbi, "getPrice"),
    read(WHITELISTER, whitelisterAbi, "isWhitelisterOfPair", [PAIR]),
    read(WHITELISTER, whitelisterAbi, "factoryAddress"),
  ]);
  const quote = await read(PAIR, pairAbi, "getAmountsOut", [units(1), path2]);
  console.log({
    partner: PARTNER,
    mon: viem.formatEther(mon),
    ausd: viem.formatUnits(ausd, 6),
    ctk: viem.formatUnits(ctk, 18),
    approvedSwapper: role,
    allowance: allowance > 10n ** 30n ? "max" : viem.formatUnits(allowance, 6),
    pair: { token0: t0, token1: t1, reserve0CTK: viem.formatUnits(r0, 18), reserve1AUSD: viem.formatUnits(r1, 6), paused, price: price.toString() },
    whitelister: { isWhitelisterOfPair: isW, factory },
    quote1AUSD: quote.map(String),
  });
}

async function simulate(usd = 1) {
  const role = await read(PAIR, pairAbi, "hasRole", ["APPROVED_SWAPPER", PARTNER]);
  if (!role) {
    await pub.simulateContract({ account: PARTNER, address: WHITELISTER, abi: whitelisterAbi, functionName: "setApprovedSwapper", args: [PARTNER] });
    console.log("setApprovedSwapper(partner): simulation passes");
  } else console.log("partner already holds APPROVED_SWAPPER");
  const amountIn = units(usd);
  const [, out] = await read(PAIR, pairAbi, "getAmountsOut", [amountIn, path2]);
  console.log(`quote: ${usd} AUSD -> ${viem.formatUnits(out, 18)} CTK`);
  if (!role) return console.log("(the swap itself can only be simulated once the role is granted)");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  try {
    const { result } = await pub.simulateContract({ account: PARTNER, address: PAIR, abi: pairAbi, functionName: "swapExactTokensForTokens", args: [amountIn, out, path2, PARTNER, deadline] });
    console.log("swap simulation passes:", result.map(String));
  } catch (e) {
    console.log("swap simulation fails:", e.shortMessage ?? e.message);
  }
}

async function send(label, request) {
  const hash = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`${label}: ${r.status} in block ${r.blockNumber}  ${hash}\n  ${explorer(hash)}`);
  if (r.status !== "success") process.exit(1);
  return hash;
}

async function gas(mon = 1) {
  const have = await pub.getBalance({ address: PARTNER });
  const want = viem.parseEther(String(mon));
  if (have >= want) return console.log(`partner already holds ${viem.formatEther(have)} MON`);
  const keeper = viem.createWalletClient({ account: accounts.privateKeyToAccount(envKey("KEEPER_KEY")), chain, transport: viem.http(chain.rpcUrls.default.http[0]) });
  const hash = await keeper.sendTransaction({ to: PARTNER, value: want - have });
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`keeper -> partner ${viem.formatEther(want - have)} MON: ${r.status}  ${hash}\n  ${explorer(hash)}`);
}

async function whitelist() {
  if (await read(PAIR, pairAbi, "hasRole", ["APPROVED_SWAPPER", PARTNER])) return console.log("partner already holds APPROVED_SWAPPER");
  const { request } = await pub.simulateContract({ account, address: WHITELISTER, abi: whitelisterAbi, functionName: "setApprovedSwapper", args: [PARTNER] });
  await send("setApprovedSwapper(partner)", request);
}

async function approve() {
  const { request } = await pub.simulateContract({ account, address: AUSD, abi: erc20, functionName: "approve", args: [PAIR, viem.maxUint256] });
  await send("AUSD.approve(pair, max)", request);
}

async function swap(usd = 1) {
  const amountIn = units(usd);
  const [, out] = await read(PAIR, pairAbi, "getAmountsOut", [amountIn, path2]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const { request } = await pub.simulateContract({ account, address: PAIR, abi: pairAbi, functionName: "swapExactTokensForTokens", args: [amountIn, out, path2, PARTNER, deadline] });
  console.log(`swapping ${usd} AUSD for ${viem.formatUnits(out, 18)} CTK`);
  await send("swapExactTokensForTokens", request);
}

/** Puts PARTNER_KEY=<key> into web/.env.local, replacing any earlier line, without echoing it. */
function writeEnv() {
  const file = path.join(ROOT, "web/.env.local");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/).filter((l) => !l.startsWith("PARTNER_KEY="));
  while (lines.length && lines.at(-1) === "") lines.pop();
  lines.push(`PARTNER_KEY=${partnerKey()}`);
  fs.writeFileSync(file, lines.join(eol) + eol);
  console.log("PARTNER_KEY written to web/.env.local");
}

function value() {
  if (process.stdout.isTTY) {
    console.error("Refusing to print the key to a terminal. Pipe it: node scripts/agora-settle.mjs value | vercel env add PARTNER_KEY production");
    process.exit(1);
  }
  process.stdout.write(partnerKey());
}

const [cmd = "status", a] = process.argv.slice(2);
const run = {
  env: writeEnv,
  value, status, simulate: () => simulate(a ? Number(a) : 1), gas: () => gas(a ? Number(a) : 1), whitelist, approve, swap: () => swap(a ? Number(a) : 1) }[cmd];
if (!run) {
  console.error("usage: node scripts/agora-settle.mjs status|simulate|gas|whitelist|approve|swap");
  process.exit(1);
}
await run();
