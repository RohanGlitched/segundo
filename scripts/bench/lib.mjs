/**
 * Shared helpers for the load benchmark. Keys are read in-process from web/.env.local and keys/bench.json
 * and never printed. viem is borrowed from the web app's node_modules so this folder needs no install.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../..");
const require = createRequire(path.join(ROOT, "web/package.json"));
export const viem = require("viem");
export const requireWeb = require;
export const accounts = require("viem/accounts");

export const RPC = process.env.BENCH_RPC || "https://testnet-rpc.monad.xyz";
export const TILL = "0xeb6c2c519c9bcc4495364c34ac116c20098113d1";
export const AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
export const FAUCET_WALLET = "0xa49d9f84FafA0FeBCBA2F02a3c0EEC75C8957534";
export const KEYS_FILE = path.join(ROOT, "keys/bench.json");

export const chain = viem.defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
export const pub = viem.createPublicClient({ chain, transport: viem.http(RPC, { retryCount: 5, retryDelay: 300 }) });

/** Reads one key from web/.env.local without exposing it to the shell or the console. */
export function envKey(name) {
  const text = fs.readFileSync(path.join(ROOT, "web/.env.local"), "utf8");
  const line = text.split(/\r?\n/).find((l) => l.startsWith(name + "="));
  if (!line) throw new Error(`${name} missing from web/.env.local`);
  let v = line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
  if (!v.startsWith("0x")) v = "0x" + v;
  return v;
}

export function loadKeys() {
  return JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
}

export function saveKeys(k) {
  fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
  fs.writeFileSync(KEYS_FILE, JSON.stringify(k, null, 2));
}

export function walletFor(pk) {
  const account = accounts.privateKeyToAccount(pk);
  return viem.createWalletClient({ account, chain, transport: viem.http(RPC, { retryCount: 3, retryDelay: 300 }) });
}

export const tillAbi = viem.parseAbi([
  "function open(address payee, address invite, uint64 rate, uint128 budget, string memo) returns (uint256)",
  "function clockIn(uint256 id)",
  "function settle(uint256 id) returns (uint128)",
  "function settleMany(uint256[] ids) returns (uint256)",
  "function close(uint256 id)",
  "function tabCount() view returns (uint256)",
  "struct Tab { address payer; uint64 rate; bool held; bool closed; address payee; uint64 since; address invite; uint64 lastBlock; uint128 budget; uint128 banked; uint128 paid; }",
  "struct TabView { uint256 id; Tab tab; uint256 earned; uint256 owed; uint256 runway; }",
  "function getTab(uint256 id) view returns (TabView v)",
  "function earned(uint256 id) view returns (uint256)",
  "event Opened(uint256 indexed id, address indexed payer, address indexed payee, uint64 rate, uint128 budget, address invite, string memo)",
  "event Settled(uint256 indexed id, address indexed payee, uint128 amount, uint128 paid)",
]);
export const erc20Abi = viem.parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function balanceOf(address a) view returns (uint256)",
  "function requestFunds(address recipient)",
]);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fmt = (wei) => Number(viem.formatEther(wei)).toFixed(4);

/** One JSON-RPC call over plain fetch, retried on rate limits. */
export async function rpc(method, params, url = RPC) {
  const [r] = await rpcBatch([{ method, params }], url);
  if (r.error) throw new Error(`${method}: ${r.error.message}`);
  return r.result;
}

/**
 * The public endpoint allows 50 calls a second, counting each call inside a batch, so every endpoint gets a
 * small budget of calls per second and waits its turn instead of being refused.
 */
const windows = new Map();
export const CALLS_PER_S = Number(process.env.BENCH_CALLS_PER_S || 45);
/** Waits until `n` more calls fit in this endpoint's last-second window (bursts allowed, never over the limit). */
async function take(url, n) {
  let w = windows.get(url);
  if (!w) windows.set(url, (w = []));
  for (;;) {
    const now = Date.now();
    while (w.length && now - w[0].at >= 1000) w.shift();
    const used = w.reduce((a, x) => a + x.n, 0);
    if (used + n <= CALLS_PER_S || !w.length) { w.push({ at: now, n }); return; }
    await sleep(1000 - (now - w[0].at) + 5);
  }
}
const limited = (r) => r?.error && /limit|too many|429/i.test(r.error.message || "");

/**
 * Many JSON-RPC calls in as few HTTP requests as possible (chunks of `size`), results in input order.
 * Rate-limited calls are retried; other per-call errors are returned, not thrown.
 */
export async function rpcBatch(calls, url = RPC, size = 40) {
  const out = new Array(calls.length);
  let todo = calls.map((_, i) => i);
  for (let attempt = 0; todo.length && attempt < 12; attempt++) {
    const retry = [];
    for (let i = 0; i < todo.length; i += size) {
      const ids = todo.slice(i, i + size);
      await take(url, ids.length);
      const chunk = ids.map((id) => ({ jsonrpc: "2.0", id, method: calls[id].method, params: calls[id].params }));
      let body = null;
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(chunk) });
        body = await res.json().catch(() => null);
      } catch {}
      if (!Array.isArray(body)) { retry.push(...ids); continue; }
      for (const r of body) {
        if (limited(r)) retry.push(r.id);
        else out[r.id] = r;
      }
      for (const id of ids) if (!out[id] && !retry.includes(id)) retry.push(id);
    }
    todo = retry;
    if (todo.length) await sleep(400 * (attempt + 1));
  }
  for (const id of todo) out[id] = { error: { message: "rate limited" } };
  return out;
}

export const MAX_FEE = 150_000_000_000n; // ceiling only; Monad bills base fee + tip (100 + 2 gwei on testnet today)
export const TIP = 2_000_000_000n;

/** Signs an EIP-1559 transaction locally with an explicit nonce and gas limit (Monad bills the limit). */
export async function sign(account, { to, data = "0x", value = 0n, gas, nonce, maxFeePerGas = MAX_FEE, maxPriorityFeePerGas = TIP }) {
  const raw = await account.signTransaction({ chainId: chain.id, type: "eip1559", to, data, value, gas, nonce, maxFeePerGas, maxPriorityFeePerGas });
  return { raw, hash: viem.keccak256(raw) };
}

/** Sends signed transactions in one batch per chunk, in order; returns per-tx { hash, sentAt, error }. */
export async function sendRaw(signed, url = RPC, size = 40) {
  const sentAt = Date.now();
  const res = await rpcBatch(signed.map((s) => ({ method: "eth_sendRawTransaction", params: [s.raw] })), url, size);
  return signed.map((s, i) => ({ hash: s.hash, sentAt, error: res[i]?.error?.message ?? null }));
}

/** Polls receipts for the given hashes until all are found or `timeoutMs` passes. */
export async function receipts(hashes, timeoutMs = 90_000) {
  const found = new Map();
  const end = Date.now() + timeoutMs;
  while (found.size < hashes.length && Date.now() < end) {
    const todo = hashes.filter((h) => !found.has(h));
    const res = await rpcBatch(todo.map((h) => ({ method: "eth_getTransactionReceipt", params: [h] })));
    res.forEach((r, i) => { if (r?.result) found.set(todo[i], r.result); });
    if (found.size < hashes.length) await sleep(500);
  }
  return found;
}

export async function nonceOf(address, tag = "pending") {
  return Number(BigInt(await rpc("eth_getTransactionCount", [address, tag])));
}
