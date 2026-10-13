import "server-only";
import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  decodeErrorResult,
  formatTransactionReceipt,
  getAddress,
  http,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type RpcTransactionReceipt,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tillAbi } from "./abi";
import { RPC_URL, TILL, monadTestnet, publicClient } from "./chain";
import { currentRelayer, laneOf, pool, poolMon, richest, type Relayer } from "./pool";

const KEYS = {
  keeper: { env: "KEEPER_KEY", who: "Relayer" },
  faucet: { env: "FAUCET_KEY", who: "Faucet" },
  treasury: { env: "TREASURY_KEY", who: "Treasury" },
} as const;

/**
 * The relayer pays gas for every signed request; the faucet hands out test AUSD; the treasury holds Segundo's fees
 * and only ever signs AUSD transfer authorisations (the relayer submits them, so it never needs MON). Keys live only in env vars.
 * "keeper" is the relayer key this request was given (lib/pool.ts), or key 0 outside a request.
 */
export function signer(kind: keyof typeof KEYS): Relayer {
  if (kind === "keeper") return currentRelayer() ?? pool()[0]!;
  const key = process.env[KEYS[kind].env]?.trim() as Hex | undefined;
  if (!key) throw new Error(`${KEYS[kind].who} is not configured on this deployment.`);
  const account = privateKeyToAccount(key);
  return createWalletClient({ account, chain: monadTestnet, transport: http(RPC_URL) });
}

type Client = Relayer;

/** Within one server instance, a signer picks its nonces one at a time, so they never collide. */
const queues = new Map<string, Promise<unknown>>();
function serialised<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(key, next);
  next.finally(() => queues.get(key) === next && queues.delete(key)).catch(() => {});
  return next;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The next nonce each key will use, as this instance knows it; read from the chain again once a key has been quiet a few seconds. */
const lanes = new Map<string, { next: number; at: number }>();

let feeCache: { at: number; fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } } | null = null;
async function feesNow() {
  if (feeCache && Date.now() - feeCache.at < 5_000) return feeCache.fees;
  const f = await publicClient.estimateFeesPerGas();
  const fees = { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas };
  feeCache = { at: Date.now(), fees };
  return fees;
}

/**
 * Sends a transaction and waits for its receipt. Monad charges for the gas limit, not gas used, and
 * prices storage differently from Ethereum, so the limit is the chain's own estimate plus 15%.
 * Only choosing the nonce and handing the signed transaction to the node is one at a time per key; the wait for the
 * block is not, so one key keeps many transactions in flight (the benchmark on /network landed 48 from one key in one block).
 * A nonce race with another instance is retried with a fresh nonce and a little jitter, and so is a call the public
 * RPC turned away for its per-second limit.
 */
export function sendAndWait(client: Client, tx: { to: Address; data: Hex; minGas?: bigint }) {
  const from = client.account.address;
  return (async () => {
    for (let attempt = 0; ; attempt++) {
      let hash: Hex;
      try {
        const [est, fees] = await Promise.all([publicClient.estimateGas({ account: from, to: tx.to, data: tx.data }), feesNow()]);
        const gas = (est * 115n) / 100n > (tx.minGas ?? 0n) ? (est * 115n) / 100n : tx.minGas!;
        hash = await serialised(from, async () => {
          let lane = lanes.get(from);
          if (!lane || Date.now() - lane.at > 3_000) {
            const onChain = await publicClient.getTransactionCount({ address: from, blockTag: "pending" });
            lane = { next: Math.max(onChain, lane?.next ?? 0), at: Date.now() };
          }
          const nonce = lane.next;
          const raw = await client.account.signTransaction({ chainId: monadTestnet.id, type: "eip1559", to: tx.to, data: tx.data, gas, nonce, ...fees });
          try {
            await publicClient.request({ method: "eth_sendRawTransaction", params: [raw] });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // "already known" is this very transaction arriving twice (a retried request): it was sent.
            if (!/already known/i.test(msg)) {
              if (/nonce too high|gap/i.test(msg)) lanes.delete(from);
              else lanes.set(from, { next: /nonce|replacement|underpriced/i.test(msg) ? nonce + 1 : nonce, at: 0 });
              throw e;
            }
          }
          lanes.set(from, { next: nonce + 1, at: Date.now() });
          return keccak256(raw);
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Nonce races, and the public RPC's per-second limit under a burst, are worth another go; reverts are not.
        if (attempt < 4 && /nonce|replacement|underpriced|request limit|rate limit|too many requests/i.test(msg)) {
          await sleep((150 + Math.random() * 400) * (attempt + 1));
          continue;
        }
        throw e;
      }
      const receipt = await receiptOf(hash, from);
      if (receipt.status !== "success") throw new Error("Monad rejected the transaction.");
      return { hash, block: Number(receipt.blockNumber), logs: receipt.logs };
    }
  })();
}

/**
 * Receipts for everything in flight come from one watcher per instance, so a busy relayer doesn't flood the public
 * RPC (it allows 50 calls a second). Asking by hash is quickest on Monad (about 0.9 s after the send, against about
 * 2 s for eth_getBlockReceipts), so the watcher asks for a few receipts by hash on every look, those asked longest
 * ago first; when more are waiting than that, it also reads whole blocks' receipts, one call per block however many
 * of ours are in it. A transaction can reach a block before the node's reply to its send comes back, so receipts of
 * the relayer's own keys seen that way are remembered for a minute.
 */
type Waiter = { from: Address; since: number; asked: number; done: (r: TransactionReceipt | Error) => void };
const waiting = new Map<string, Waiter>();
let watching = false;
let blockReceipts = true;
const RECEIPT_TIMEOUT = 30_000;
/** Receipts asked for by hash on each look (every 200 ms). */
const BY_HASH = 4;
const recent = new Map<string, { at: number; receipt: TransactionReceipt }>();

function receiptOf(hash: Hex, from: Address): Promise<TransactionReceipt> {
  const early = recent.get(hash.toLowerCase());
  if (early) return Promise.resolve(early.receipt);
  return new Promise((resolve, reject) => {
    const now = Date.now();
    waiting.set(hash.toLowerCase(), { from, since: now, asked: now, done: (r) => (r instanceof Error ? reject(r) : resolve(r)) });
    watch();
  });
}

function found(hash: string, r: TransactionReceipt | Error) {
  const w = waiting.get(hash.toLowerCase());
  if (!w) return;
  waiting.delete(hash.toLowerCase());
  w.done(r);
}

function watch() {
  if (watching) return;
  watching = true;
  let last: bigint | null = null;
  let head: bigint | null = null;
  let readAt = 0;

  /** Reads the receipts of the blocks after the last one read: side by side when behind, the next two when caught up. */
  async function readBlocks(look: number) {
    if (last === null || look % 8 === 0 || Date.now() - readAt > 1_500) {
      // Start a few blocks back (a transaction can land before the first look), and skip ahead after a stall.
      const h = await publicClient.getBlockNumber({ cacheTime: 0 }).catch(() => null);
      if (h !== null && (head === null || h > head)) head = h;
      if (h !== null && (last === null || h - last > 30n)) last = h - 10n;
    }
    if (last === null) return;
    const from: bigint = last;
    const count = head !== null && head - from > 2n ? Math.min(Number(head - from), 12) : 2;
    const blocks = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        (publicClient.request({ method: "eth_getBlockReceipts", params: [toHex(from + 1n + BigInt(i))] } as never) as Promise<RpcTransactionReceipt[] | null>).catch((e: unknown) => {
          if (/not (found|supported|available)|does not exist|unsupported/i.test(e instanceof Error ? e.message : String(e))) blockReceipts = false;
          return null;
        }),
      ),
    );
    const at = (readAt = Date.now());
    for (let i = 0; i < blocks.length; i++) {
      const raw = blocks[i];
      if (!raw) break; // not served yet: ask again on the next look
      for (const r of raw) {
        if (waiting.has(r.transactionHash.toLowerCase())) found(r.transactionHash, formatTransactionReceipt(r));
        else if (lanes.has(getAddress(r.from))) recent.set(r.transactionHash.toLowerCase(), { at, receipt: formatTransactionReceipt(r) });
      }
      last = from + 1n + BigInt(i);
      if (head === null || last > head) head = last;
    }
    for (const [hash, r] of recent) if (at - r.at > 60_000) recent.delete(hash);
  }

  (async () => {
    for (let look = 0; waiting.size; look++) {
      await sleep(200);
      const now = Date.now();
      const due = [...waiting].filter(([, w]) => now - w.since > 500).sort((a, b) => a[1].asked - b[1].asked);
      const ask = due.slice(0, blockReceipts ? BY_HASH : 3 * BY_HASH);
      await Promise.all([
        ...ask.map(async ([hash, w]) => {
          w.asked = now;
          const r = await publicClient.getTransactionReceipt({ hash: hash as Hex }).catch(() => null);
          if (r) found(hash, r);
        }),
        blockReceipts && waiting.size > ask.length ? readBlocks(look) : null,
      ]);
      for (const [hash, w] of waiting) {
        if (now - w.since < RECEIPT_TIMEOUT) continue;
        // A transaction that never landed leaves a hole in its key's nonces: read them from the chain again.
        lanes.delete(w.from);
        found(hash, new Error("The transaction didn't reach a block in time. Try again in a moment."));
      }
    }
  })()
    .catch((e) => console.error(`receipt watcher: ${e instanceof Error ? e.message : e}`))
    .finally(() => {
      watching = false;
      if (waiting.size) watch();
    });
}

/** Pulls Till's custom error name out of a failed simulation so the app can explain it. */
export function revertReason(e: unknown): string {
  // The relayer itself cannot pay: say so in the same words as the notice bar, never a raw RPC line.
  if (/insufficient funds|exceeds the balance/i.test(e instanceof Error ? e.message : String(e))) return LOW_GAS;
  if (e instanceof BaseError) {
    const revert = e.walk((err) => err instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (revert?.data?.errorName) return revert.data.errorName;
    const raw = e.walk((err) => typeof (err as { data?: unknown }).data === "string") as { data?: Hex } | null;
    if (raw?.data) {
      try {
        return decodeErrorResult({ abi: tillAbi, data: raw.data }).errorName;
      } catch {}
    }
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Very small in-memory limiter per serverless instance; enough to stop a runaway loop on testnet. */
const hits = new Map<string, number[]>();
let lastPrune = 0;
export function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (now - lastPrune > 60_000) {
    // Forget keys that have gone quiet, so a stream of fresh signers can't grow the map without end.
    lastPrune = now;
    for (const [k, list] of hits) if (now - (list.at(-1) ?? 0) > 3_600_000) hits.delete(k);
  }
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return true;
  }
  list.push(now);
  hits.set(key, list);
  return false;
}

/** The caller's address as the platform saw it (Vercel sets x-real-ip; the first forwarded hop is the fallback). */
export const clientIp = (req: Request) => req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "?";

/** The smallest tab budget or top-up the relayer will pay gas for: half a test dollar. */
export const MIN_BUDGET = 500_000n;

/**
 * How much test MON the relayer keeps back before it pays for each kind of action, so that when gas
 * runs low the actions that return money (clock-outs, closes, cash-outs) keep working longest.
 * Watch-payouts stop first, then new tabs and transfers, then clock-ins; closes run to the last drop.
 */
export const RESERVE = {
  settle: 400_000_000_000_000_000n, // 0.4 MON: watch-payouts pause
  open: 150_000_000_000_000_000n, // 0.15 MON: new tabs, top-ups, sends and profiles pause
  clockIn: 50_000_000_000_000_000n, // 0.05 MON: clock-ins pause
  essential: 20_000_000_000_000_000n, // 0.02 MON, about one transaction: clock-outs, holds, closes and invite claims run until then
} as const;

/** Which reserve a forwarded Till call must clear. */
export function reserveFor(fn: string): keyof typeof RESERVE {
  if (fn === "settle") return "settle";
  if (fn === "clockIn") return "clockIn";
  if (fn === "clockOut" || fn === "hold" || fn === "close" || fn === "claim") return "essential";
  return "open";
}

export const LOW_GAS =
  "The relayer is short of test MON, so this action is paused for the moment. Nothing you have earned is lost: pay already locked in the contract is paid out as soon as gas is back.";

/** The MON of the relayer key this request was given (key 0 outside a request), read at most every ten seconds per instance. */
export async function keeperMon(): Promise<bigint | null> {
  const keys = pool();
  const i = keys.indexOf(signer("keeper"));
  return (await poolMon())[i < 0 ? 0 : i] ?? null;
}

/** Refuses an action when no relayer key holds the MON its tier needs; returns the message to show. */
export async function lowOnGas(tier: keyof typeof RESERVE): Promise<string | null> {
  const mon = await poolMon();
  const best = mon[richest(mon)];
  if (best == null) return null; // an RPC hiccup must not block the action; the send itself will fail loudly
  return best < RESERVE[tier] ? LOW_GAS : null;
}

/**
 * The relayer key for a request: hash(address) mod N for a person, id mod N for a tab, so one person's actions stay
 * in order on one key while different people's run side by side. Reserve tiers apply to that key; when it is below
 * the tier, the richest key in the pool takes the request instead, and only when even that one is short is the
 * action paused (with the message to show).
 */
export async function relayerFor(seed: Address | bigint, tier: keyof typeof RESERVE): Promise<{ relayer: Client; low: string | null }> {
  const keys = pool();
  const i = laneOf(seed, keys.length);
  const mon = await poolMon();
  if (mon[i] == null || mon[i]! >= RESERVE[tier]) return { relayer: keys[i]!, low: null };
  const r = richest(mon);
  if (mon[r] != null && mon[r]! >= RESERVE[tier]) return { relayer: keys[r]!, low: null };
  return { relayer: keys[i]!, low: LOW_GAS };
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export { TILL };
export { asRelayer } from "./pool";
