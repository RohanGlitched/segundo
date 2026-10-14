import "server-only";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
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

/**
 * The relayer's own line to Monad. viem's default waits 10 s for an answer and then asks again, so one public-RPC
 * call that never comes back held a payout for 10 or 20 s (measured on segundo.world: 10.98 s and 20.28 s landings
 * between 0.7 to 1.4 s ones, with nothing else queued on that key and the base fee flat). From the server a Monad read
 * answers in a fraction of a second, so a read that hasn't answered in 1.5 s is asked again at once; calls go one per
 * HTTP request, so a slow one can't hold up a batch.
 */
export const rpc = createPublicClient({ chain: monadTestnet, transport: http(RPC_URL, { timeout: 1_500, retryCount: 2, retryDelay: 50 }) });
/** For receipt looks and sends: never retried by viem (the watcher looks again in a moment; a send is handled below). */
const once = createPublicClient({ chain: monadTestnet, transport: http(RPC_URL, { timeout: 2_500, retryCount: 0 }) });

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
  const f = await rpc.estimateFeesPerGas();
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
 * `ms` is the time from handing the signed transaction to the node to seeing its receipt: what "landed in" means.
 */
export function sendAndWait(client: Client, tx: { to: Address; data: Hex; minGas?: bigint }) {
  const from = client.account.address;
  return (async () => {
    for (let attempt = 0; ; attempt++) {
      let hash: Hex;
      let sentAt = 0;
      try {
        const [est, fees] = await Promise.all([rpc.estimateGas({ account: from, to: tx.to, data: tx.data }), feesNow()]);
        const gas = (est * 115n) / 100n > (tx.minGas ?? 0n) ? (est * 115n) / 100n : tx.minGas!;
        hash = await serialised(from, async () => {
          let lane = lanes.get(from);
          if (!lane || Date.now() - lane.at > 3_000) {
            const onChain = await rpc.getTransactionCount({ address: from, blockTag: "pending" });
            lane = { next: Math.max(onChain, lane?.next ?? 0), at: Date.now() };
          }
          const nonce = lane.next;
          const raw = await client.account.signTransaction({ chainId: monadTestnet.id, type: "eip1559", to: tx.to, data: tx.data, gas, nonce, ...fees });
          sentAt = Date.now();
          try {
            await once.request({ method: "eth_sendRawTransaction", params: [raw] });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // "already known" is this very transaction arriving twice (a retried request): it was sent. A send the node
            // didn't answer in time may well have reached it: wait for its receipt rather than sign a second one (the
            // receipt watcher gives up after 30 s and the key's nonces are read afresh).
            if (!/already known|took too long|timed? ?out/i.test(msg)) {
              // Monad answers a nonce another instance already used with "invalid parameters" (-32602):
              // forget the lane so the next try reads the pending count afresh.
              if (/nonce too high|gap|invalid param|missing or invalid/i.test(msg)) lanes.delete(from);
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
        if (attempt < 4 && /nonce|replacement|underpriced|invalid param|missing or invalid|request limit|rate limit|too many requests/i.test(msg)) {
          await sleep((150 + Math.random() * 400) * (attempt + 1));
          continue;
        }
        throw e;
      }
      const { receipt, at } = await receiptOf(hash, from);
      if (receipt.status !== "success") throw new Error("Monad rejected the transaction.");
      return { hash, block: Number(receipt.blockNumber), logs: receipt.logs, ms: Math.max(0, at - sentAt) };
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
type Seen = { receipt: TransactionReceipt; at: number };
const waiting = new Map<string, Waiter>();
let watching = false;
let blockReceipts = true;
const RECEIPT_TIMEOUT = 30_000;
/** Receipts asked for by hash on each look. */
const BY_HASH = 4;
/**
 * Looks come every 120 ms while one or two transactions wait (a receipt is first asked for 300 ms after the send, as
 * Monad rarely has one sooner), and every 200 ms when more are waiting, which keeps a busy instance under the RPC's limit.
 */
const LOOK_MS = (n: number) => (n <= 2 ? 120 : 200);
const FIRST_LOOK_MS = 300;
const recent = new Map<string, { at: number; receipt: TransactionReceipt }>();

/** The receipt, and when this instance first saw it. */
function receiptOf(hash: Hex, from: Address): Promise<Seen> {
  const early = recent.get(hash.toLowerCase());
  if (early) return Promise.resolve(early);
  return new Promise((resolve, reject) => {
    const now = Date.now();
    waiting.set(hash.toLowerCase(), { from, since: now, asked: now, done: (r) => (r instanceof Error ? reject(r) : resolve({ receipt: r, at: Date.now() })) });
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
      const h = await once.getBlockNumber({ cacheTime: 0 }).catch(() => null);
      if (h !== null && (head === null || h > head)) head = h;
      if (h !== null && (last === null || h - last > 30n)) last = h - 10n;
    }
    if (last === null) return;
    const from: bigint = last;
    const count = head !== null && head - from > 2n ? Math.min(Number(head - from), 12) : 2;
    const blocks = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        (once.request({ method: "eth_getBlockReceipts", params: [toHex(from + 1n + BigInt(i))] } as never) as Promise<RpcTransactionReceipt[] | null>).catch((e: unknown) => {
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
      await sleep(LOOK_MS(waiting.size));
      const now = Date.now();
      const due = [...waiting].filter(([, w]) => now - w.since >= FIRST_LOOK_MS).sort((a, b) => a[1].asked - b[1].asked);
      const ask = due.slice(0, blockReceipts ? BY_HASH : 3 * BY_HASH);
      await Promise.all([
        ...ask.map(async ([hash, w]) => {
          w.asked = now;
          const r = await once.getTransactionReceipt({ hash: hash as Hex }).catch(() => null);
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

/**
 * Very small in-memory limiter per serverless instance; enough to stop a runaway loop on testnet. The relay layers
 * it (per signer, per IP, per tab and overall, by the minute and by the hour), and refuses calls that change
 * nothing (noOp), so a loop of free calls pays for itself in fresh tabs or fresh IP addresses.
 */
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

type TabRead = { tab: { payer: Address; rate: bigint; held: boolean; closed: boolean }; owed: bigint };

/**
 * Why a relayed Till call would change nothing, or null when it does something. These calls are valid on chain
 * and carry no fee, so each one would only burn the relayer's gas: a hold to the state the tab is already in, the
 * rate it already pays, a payout with nothing owed, the profile already set. Calls the contract itself refuses
 * (clocking in twice, closing a closed tab) never get this far: their simulation fails first. A failed read lets the
 * call through; the send itself is simulated again.
 */
export async function noOp(fn: string, args: readonly unknown[], from: Address): Promise<string | null> {
  try {
    if (fn === "setProfile") {
      const p = (await publicClient.readContract({ address: TILL, abi: tillAbi, functionName: "profileOf", args: [from] })) as { name: string; place: string; currency: Hex };
      const same = p.name === args[0] && p.place === args[1] && p.currency.toLowerCase() === String(args[2]).toLowerCase();
      return same ? "Your profile already says that." : null;
    }
    if (fn !== "hold" && fn !== "setRate" && fn !== "settle") return null;
    const v = (await publicClient.readContract({ address: TILL, abi: tillAbi, functionName: "getTab", args: [args[0] as bigint] })) as TabRead;
    if (fn === "hold" && v.tab.held === args[1]) return v.tab.held ? "This tab is already on hold." : "This tab isn't on hold.";
    if (fn === "setRate" && v.tab.rate === args[1]) return "The tab already pays that rate.";
    if (fn === "settle" && v.owed === 0n) return "Nothing is owed on this tab right now.";
    return null;
  } catch {
    return null;
  }
}

/** The caller's address as the platform saw it (Vercel sets x-real-ip; the first forwarded hop is the fallback). */
export const clientIp = (req: Request) => req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "?";

/** The smallest tab budget or top-up the relayer will pay gas for: half a test dollar. */
export const MIN_BUDGET = 500_000n;

/**
 * How much test MON the relayer keeps back before it pays for each kind of action, so that when gas
 * runs low the actions that return money keep working longest. Watch-payouts stop first, then new tabs and
 * transfers, then clock-ins and cash-outs; clock-outs, holds and closes run to the last drop.
 */
export const RESERVE = {
  settle: 400_000_000_000_000_000n, // 0.4 MON: watch-payouts pause
  open: 150_000_000_000_000_000n, // 0.15 MON: new tabs, top-ups, sends and profiles pause
  clockIn: 50_000_000_000_000_000n, // 0.05 MON: clock-ins and cash-outs (sends to the payout partner) pause
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

/**
 * The pool's MON for choosing a key, waiting at most 1.5 s: past that the action goes ahead on its own key, as it does
 * when a read fails (the send itself fails loudly if that key really is dry).
 */
export const monSoon = (): Promise<(bigint | null)[]> => Promise.race([poolMon(), sleep(1_500).then(() => [] as (bigint | null)[])]);

/** Refuses an action when no relayer key holds the MON its tier needs; returns the message to show. */
export async function lowOnGas(tier: keyof typeof RESERVE): Promise<string | null> {
  const mon = await monSoon();
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
  const mon = await monSoon();
  if (mon[i] == null || mon[i]! >= RESERVE[tier]) return { relayer: keys[i]!, low: null };
  const r = richest(mon);
  if (mon[r] != null && mon[r]! >= RESERVE[tier]) return { relayer: keys[r]!, low: null };
  return { relayer: keys[i]!, low: LOW_GAS };
}

/**
 * The key a watched tab's payouts go out on: id mod (N - 1), skipping key 0. Key 0 is also the demo bots' keeper
 * (it counts its own nonces between runs) and the pool's richest key, which takes every request whose own key is
 * short, so a payout queued there waits behind other people's work. With a one-key pool it is key 0 after all.
 */
export async function settleRelayer(id: bigint): Promise<{ relayer: Client; low: string | null }> {
  const keys = pool();
  if (keys.length < 2) return relayerFor(id, "settle");
  const i = 1 + Number(id % BigInt(keys.length - 1));
  const mon = await monSoon();
  if (mon[i] == null || mon[i]! >= RESERVE.settle) return { relayer: keys[i]!, low: null };
  return relayerFor(id, "settle");
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export { TILL };
export { asRelayer } from "./pool";
