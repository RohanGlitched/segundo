import "server-only";
import { decodeEventLog, encodeEventTopics, getAddress, pad, type Address, type Hex } from "viem";
import { tillAbi } from "./abi";
import { DOLLAR, FORWARDER, RPC_URL, TILL, TREASURY, publicClient } from "./chain";
import { BENCH_ADDRESSES, BENCH_TABS } from "./bench-addresses";
import { DEMO_CLIENTS, DEMO_FREELANCERS, DEMO_WALLETS } from "./demo";
import { feeFor } from "./money";
import { readTabs, type TabView } from "./tabs";

/**
 * Segundo's on-chain ledger, read from Monad through Envio HyperRPC.
 *
 * HyperRPC answers standard eth_getLogs over hundreds of thousands of blocks per call (Monad's public RPC caps a log
 * query at 100 blocks), so every Till event since deployment and every AUSD fee into the treasury can be read in a
 * few calls. Each serverless instance keeps the result in memory and only reads the new blocks after that.
 * Without ENVIO_API_TOKEN, or if HyperRPC fails before a first full read, the public RPC covers a short recent
 * window instead and everything built on it says `source: "rpc"`.
 *
 * The token sits in the HyperRPC URL, so the URL is never logged or put in an error message.
 */

/** Block of Till's deployment (tx 0x12ec03d3…, see VERIFY.md); nothing older can hold its events. */
export const DEPLOY_BLOCK = 68_119_428n;
const TILL_ADDRESS: Address = /^0x0+$/.test(TILL) ? "0xeb6c2c519c9bcc4495364c34ac116c20098113d1" : TILL;
const FORWARDER_ADDRESS: Address = /^0x0+$/.test(FORWARDER) ? "0xB0Af71Dfb11df900B2B1a63De0D156e7f035B4D1" : FORWARDER;
/** First block of the 1% client fee (see VERIFY.md): opens and top-ups sent through Segundo from here on carry it. */
export const FEE_BLOCK = 70_674_000;
/** How far apart a fee and the open or top-up it paid for may sit, either way round (the fee now goes first). */
const FEE_MATCH_BLOCKS = 600;

const TTL_MS = 60_000;
/**
 * HyperRPC: blocks per log query. The filters are sparse, so one query covers everything since deployment in a
 * few seconds, and few queries matter: HyperRPC answers 429 after a handful in quick succession. A query that
 * times out is split in half and tried again.
 */
const ENVIO_SPAN = 3_000_000n;
const ENVIO_MIN_SPAN = 5_000n;
/** Public RPC fallback: its 100-block cap means only the most recent stretch is read (about four minutes). */
const RPC_SPAN = 100n;
const RPC_WINDOW = 600n;
/** The fallback's share of an 8-second request: block number, then the window, then contract state for totals. */
const RPC_TIP_MS = 1_500;
const RPC_WINDOW_MS = 4_000;
const RPC_STATE_MS = 2_500;

export type Source = "envio-hyperrpc" | "rpc";

type Base = { block: number; time: number; hash: Hex; logIndex: number };
export type TillEvent = Base &
  (
    | { name: "Opened"; id: bigint; payer: Address; payee: Address; budget: bigint }
    | { name: "Claimed"; id: bigint; payee: Address }
    | { name: "ClockedIn"; id: bigint }
    | { name: "ClockedOut"; id: bigint; by: Address }
    | { name: "ToppedUp"; id: bigint; amount: bigint }
    | { name: "Settled"; id: bigint; payee: Address; amount: bigint }
    | { name: "Closed"; id: bigint; paid: bigint; refunded: bigint }
  );
export type FeeEvent = Base & { from: Address; amount: bigint };
/** AUSD leaving the treasury: a fee refund (1% of the unspent budget at close, or a whole fee whose open failed). */
export type Outflow = Base & { to: Address; amount: bigint };

type Ledger = {
  source: Source;
  /** Last block read, inclusive. */
  head: bigint;
  /** First block read: the deployment block for HyperRPC, the start of the recent window for the public RPC. */
  from: bigint;
  events: TillEvent[];
  /**
   * Every AUSD transfer into the treasury. Anyone can send AUSD to any address, so only the ones in `linked`
   * (paired with an open or top-up) count as fees anywhere on the site.
   */
  fees: FeeEvent[];
  refunds: Outflow[];
  /** Fee → the tab it paid for. Rebuilt once per refresh, not per request. */
  linked: Map<FeeEvent, string>;
  /** Opens and top-ups ("txHash:logIndex") that a fee was matched to. */
  feePaid: Set<string>;
  /** Transactions (lower-case hashes) that went through the forwarder: signed in the app, sent by Segundo's relayer. */
  forwarded: Set<string>;
  keys: Set<string>;
  at: number;
};

type RawLog = {
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  blockTimestamp?: Hex;
  transactionHash: Hex;
  logIndex: Hex;
};

const WATCHED = ["Opened", "Claimed", "ClockedIn", "ClockedOut", "ToppedUp", "Settled", "Closed"] as const;
const TILL_TOPICS = WATCHED.map((eventName) => encodeEventTopics({ abi: tillAbi, eventName } as never)[0] as Hex);
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex;
const TREASURY_TOPIC = pad(TREASURY.toLowerCase() as Hex, { size: 32 });
/** OpenZeppelin ERC2771Forwarder's ExecutedForwardRequest(address indexed signer, uint256 nonce, bool success). */
const FORWARDED_TOPIC = "0x842fb24a83793558587a3dab2be7674da4a51d09c5542d6dd354e5d0ea70813c" as Hex;

const envioUrl = () => {
  const token = process.env.ENVIO_API_TOKEN?.trim();
  return token ? `https://monad-testnet.rpc.hypersync.xyz/${token}` : null;
};

/** A per-call timeout that also ends when the read it belongs to is abandoned. */
const within = (ms: number, outer?: AbortSignal) => (outer ? AbortSignal.any([outer, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

/** One JSON-RPC call with a hard timeout. Errors carry the method, never the URL. */
async function call<T>(url: string, method: string, params: unknown[], ms: number, outer?: AbortSignal, retries = 2): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: within(ms, outer),
      cache: "no-store",
    });
  } catch (e) {
    if (outer?.aborted) throw new Error(`${method}: abandoned`);
    throw new Error(`${method}: ${e instanceof Error && e.name === "TimeoutError" ? "timed out" : "unreachable"}`);
  }
  if (res.status === 429 && retries > 0 && !outer?.aborted) {
    // Rate limited: wait a moment and ask again rather than fall back to a four-minute window.
    await new Promise((r) => setTimeout(r, 1_200));
    return call<T>(url, method, params, ms, outer, retries - 1);
  }
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message ?? "error"}`);
  return body.result as T;
}

const hex = (n: bigint) => `0x${n.toString(16)}`;

/** Runs tasks a few at a time. */
async function pool<T>(tasks: (() => Promise<T>)[], width: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        out[i] = await tasks[i]();
      }
    }),
  );
  return out;
}

type Filter = { address: Address | Address[]; topics: (Hex | Hex[] | null)[] };

/** HyperRPC: big ranges, split in half whenever one is too heavy to answer in time. */
async function envioLogs(url: string, filter: Filter, from: bigint, to: bigint, signal?: AbortSignal): Promise<RawLog[]> {
  const ranges: [bigint, bigint][] = [];
  for (let a = from; a <= to; a += ENVIO_SPAN) ranges.push([a, a + ENVIO_SPAN - 1n > to ? to : a + ENVIO_SPAN - 1n]);
  const one = async (a: bigint, b: bigint): Promise<RawLog[]> => {
    try {
      return await call<RawLog[]>(url, "eth_getLogs", [{ ...filter, fromBlock: hex(a), toBlock: hex(b) }], 9_000, signal);
    } catch (e) {
      // An abandoned or rate-limited read stops here instead of splitting into ever more requests.
      if (b - a < ENVIO_MIN_SPAN || signal?.aborted || (e instanceof Error && e.message.includes("HTTP 429"))) throw e;
      const mid = a + (b - a) / 2n;
      const [x, y] = await Promise.all([one(a, mid), one(mid + 1n, b)]);
      return [...x, ...y];
    }
  };
  return (await pool(ranges.map(([a, b]) => () => one(a, b)), 4)).flat();
}

/** Public RPC: 100-block pages over a short window. */
async function rpcLogs(filter: Filter, from: bigint, to: bigint, signal?: AbortSignal): Promise<RawLog[]> {
  const tasks: (() => Promise<RawLog[]>)[] = [];
  for (let a = from; a <= to; a += RPC_SPAN) {
    const b = a + RPC_SPAN - 1n > to ? to : a + RPC_SPAN - 1n;
    tasks.push(() => call<RawLog[]>(RPC_URL, "eth_getLogs", [{ ...filter, fromBlock: hex(a), toBlock: hex(b) }], 4_000, signal));
  }
  return (await pool(tasks, 6)).flat();
}

/** Several JSON-RPC calls in one POST (HyperRPC answers batches of 50 block reads in a second or two). */
async function batch<T>(url: string, method: string, params: unknown[][], ms: number, signal?: AbortSignal): Promise<(T | null)[]> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params.map((p, id) => ({ jsonrpc: "2.0", id, method, params: p }))),
    signal: within(ms, signal),
    cache: "no-store",
  }).catch(() => null);
  if (!res?.ok) return params.map(() => null);
  const body = (await res.json().catch(() => null)) as { id: number; result?: T }[] | null;
  const out: (T | null)[] = params.map(() => null);
  if (Array.isArray(body)) for (const r of body) if (typeof r.id === "number" && r.result != null) out[r.id] = r.result;
  return out;
}

/**
 * Logs usually carry blockTimestamp, but HyperRPC leaves it out on some. Those blocks are read in batches; any
 * still unknown after that (a timeout) take a time interpolated between the nearest known blocks, which on Monad's
 * steady block pace lands within seconds.
 */
async function fillTimes(logs: RawLog[], url: string, known: [number, number][], signal?: AbortSignal) {
  const missing = [...new Set(logs.filter((l) => !l.blockTimestamp).map((l) => l.blockNumber))];
  if (!missing.length) return;
  const times = new Map<string, Hex>();
  const groups: string[][] = [];
  for (let i = 0; i < missing.length; i += 50) groups.push(missing.slice(i, i + 50));
  const stop = Date.now() + 9_000;
  // A batch that comes back empty (usually HyperRPC's rate limit) ends the reads: the rest are interpolated.
  let refused = false;
  await pool(
    groups.map((g) => async () => {
      if (refused || Date.now() > stop || signal?.aborted) return;
      const blocks = await batch<{ timestamp: Hex }>(url, "eth_getBlockByNumber", g.map((n) => [n, false]), 6_000, signal);
      if (blocks.every((b) => !b)) refused = true;
      blocks.forEach((b, i) => b && times.set(g[i], b.timestamp));
    }),
    2,
  );
  if (signal?.aborted) throw new Error("block times: abandoned");
  for (const l of logs) if (!l.blockTimestamp) l.blockTimestamp = times.get(l.blockNumber);
  const points = [...known, ...logs.filter((l) => l.blockTimestamp).map((l) => [Number(l.blockNumber), Number(l.blockTimestamp)] as [number, number])].sort(
    (a, b) => a[0] - b[0],
  );
  for (const l of logs) {
    if (l.blockTimestamp || !points.length) continue;
    const n = Number(l.blockNumber);
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (points[mid][0] <= n) lo = mid;
      else hi = mid - 1;
    }
    const a = points[lo][0] <= n ? points[lo] : null;
    const b = points.find((p) => p[0] >= n) ?? null;
    const t = a && b && b[0] !== a[0] ? a[1] + ((b[1] - a[1]) * (n - a[0])) / (b[0] - a[0]) : (a ?? b)![1];
    l.blockTimestamp = `0x${Math.round(t).toString(16)}`;
  }
}

function decodeTill(l: RawLog): TillEvent | null {
  let ev;
  try {
    ev = decodeEventLog({ abi: tillAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
  } catch {
    return null;
  }
  const a = ev.args as Record<string, unknown>;
  const base: Base = { block: Number(l.blockNumber), time: Number(l.blockTimestamp ?? 0), hash: l.transactionHash, logIndex: Number(l.logIndex) };
  const id = a.id as bigint;
  switch (ev.eventName) {
    case "Opened":
      return { ...base, name: "Opened", id, payer: a.payer as Address, payee: a.payee as Address, budget: a.budget as bigint };
    case "Claimed":
      return { ...base, name: "Claimed", id, payee: a.payee as Address };
    case "ClockedIn":
      return { ...base, name: "ClockedIn", id };
    case "ClockedOut":
      return { ...base, name: "ClockedOut", id, by: a.by as Address };
    case "ToppedUp":
      return { ...base, name: "ToppedUp", id, amount: a.amount as bigint };
    case "Settled":
      return { ...base, name: "Settled", id, payee: a.payee as Address, amount: a.amount as bigint };
    case "Closed":
      return { ...base, name: "Closed", id, paid: a.paid as bigint, refunded: a.refunded as bigint };
    default:
      return null;
  }
}

/** An AUSD Transfer log, both sides. */
function decodeTransfer(l: RawLog) {
  if (l.topics.length < 3) return null;
  return {
    block: Number(l.blockNumber),
    time: Number(l.blockTimestamp ?? 0),
    hash: l.transactionHash,
    logIndex: Number(l.logIndex),
    from: getAddress(`0x${l.topics[1].slice(26)}`),
    to: getAddress(`0x${l.topics[2].slice(26)}`),
    amount: BigInt(l.data),
  };
}

const keyOf = (l: RawLog) => `${l.transactionHash}:${Number(l.logIndex)}`;
const order = (a: Base, b: Base) => a.block - b.block || a.logIndex - b.logIndex;

/**
 * Reads [from, to] from one provider and folds it into a ledger (new or existing), skipping logs already held.
 * Nothing is folded in until every read has answered, so an abandoned scan leaves a held ledger as it was.
 */
async function scan(source: Source, from: bigint, to: bigint, into?: Ledger, signal?: AbortSignal): Promise<Ledger> {
  const url = source === "envio-hyperrpc" ? envioUrl()! : RPC_URL;
  const read = source === "envio-hyperrpc" ? (f: Filter) => envioLogs(url, f, from, to, signal) : (f: Filter) => rpcLogs(f, from, to, signal);
  // Till's events and the forwarder's share one query (neither contract emits the other's events).
  const [contractLogs, feeLogs, outLogs] = await Promise.all([
    read({ address: [TILL_ADDRESS, FORWARDER_ADDRESS], topics: [[...TILL_TOPICS, FORWARDED_TOPIC]] }),
    read({ address: DOLLAR, topics: [TRANSFER_TOPIC, null, TREASURY_TOPIC] }),
    read({ address: DOLLAR, topics: [TRANSFER_TOPIC, TREASURY_TOPIC] }),
  ]);
  const tillLogs = contractLogs.filter((l) => l.topics[0] !== FORWARDED_TOPIC);
  const fwdLogs = contractLogs.filter((l) => l.topics[0] === FORWARDED_TOPIC);
  const known: [number, number][] = into ? [...into.events, ...into.fees].slice(-50).map((e) => [e.block, e.time]) : [];
  await fillTimes([...tillLogs, ...feeLogs, ...outLogs], url, known, signal);
  const ledger: Ledger = into ?? {
    source,
    head: to,
    from,
    events: [],
    fees: [],
    refunds: [],
    linked: new Map(),
    feePaid: new Set(),
    forwarded: new Set(),
    keys: new Set(),
    at: Date.now(),
  };
  for (const l of tillLogs) {
    const k = keyOf(l);
    if (ledger.keys.has(k)) continue;
    const ev = decodeTill(l);
    if (!ev) continue;
    ledger.keys.add(k);
    ledger.events.push(ev);
  }
  for (const l of feeLogs) {
    const k = keyOf(l);
    if (ledger.keys.has(k)) continue;
    const t = decodeTransfer(l);
    if (!t) continue;
    ledger.keys.add(k);
    ledger.fees.push({ block: t.block, time: t.time, hash: t.hash, logIndex: t.logIndex, from: t.from, amount: t.amount });
  }
  for (const l of outLogs) {
    const k = `out:${keyOf(l)}`;
    if (ledger.keys.has(k)) continue;
    const t = decodeTransfer(l);
    if (!t) continue;
    ledger.keys.add(k);
    ledger.refunds.push({ block: t.block, time: t.time, hash: t.hash, logIndex: t.logIndex, to: t.to, amount: t.amount });
  }
  for (const l of fwdLogs) ledger.forwarded.add(l.transactionHash.toLowerCase());
  ledger.events.sort(order);
  ledger.fees.sort(order);
  ledger.refunds.sort(order);
  const matched = feeTabs(ledger.events, ledger.fees, parties(ledger.events));
  ledger.linked = matched.byFee;
  ledger.feePaid = matched.funded;
  ledger.head = to > ledger.head ? to : ledger.head;
  ledger.at = Date.now();
  return ledger;
}

let envioLedger: Ledger | null = null;
let rpcLedger: Ledger | null = null;
let inflight: Promise<Ledger> | null = null;
/** After HyperRPC fails with nothing held, the fallback is used for a minute before HyperRPC is tried again. */
let envioFailedAt = 0;
/** Why the last HyperRPC read failed (the method and the error, never the URL), for `fallback` in the stats. */
let envioError: string | null = null;

const withDeadline = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what}: over ${ms} ms`)), ms))]);

/** Like withDeadline, but the work gets a signal that is aborted at the deadline, so its requests stop as well. */
async function abortable<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, what: string): Promise<T> {
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      stop.abort();
      reject(new Error(`${what}: over ${ms} ms`));
    }, ms);
  });
  try {
    return await Promise.race([work(stop.signal), late]);
  } finally {
    clearTimeout(timer);
  }
}

async function refresh(): Promise<Ledger> {
  const envio = envioUrl();
  if (envio) {
    try {
      // HyperRPC's own head, so a range never runs past the block it has indexed.
      const tip = BigInt(await call<Hex>(envio, "eth_blockNumber", [], 4_000));
      if (envioLedger) {
        const held = envioLedger;
        // A few blocks of overlap; logs already held are skipped by key.
        const from = held.head > 5n ? held.head - 5n : 0n;
        if (tip > held.head) await abortable((signal) => scan("envio-hyperrpc", from, tip, held, signal), 8_000, "HyperRPC refresh");
        held.at = Date.now();
        return held;
      }
      envioLedger = await abortable((signal) => scan("envio-hyperrpc", DEPLOY_BLOCK, tip, undefined, signal), 25_000, "HyperRPC first read");
      return envioLedger;
    } catch (e) {
      envioError = e instanceof Error ? e.message : "failed";
      console.warn("envio:", envioError);
      envioFailedAt = Date.now();
      // A full ledger a minute old beats a short window: keep serving it and try again on the next request.
      if (envioLedger) return envioLedger;
    }
  }
  const tip = await withDeadline(publicClient.getBlockNumber({ cacheTime: 0 }), RPC_TIP_MS, "block number");
  const from = tip > RPC_WINDOW ? tip - RPC_WINDOW + 1n : 0n;
  rpcLedger = await abortable((signal) => scan("rpc", from, tip, undefined, signal), RPC_WINDOW_MS, "RPC window");
  return rpcLedger;
}

/** The current ledger: from memory within 60 s, otherwise refreshed (one refresh at a time per instance). */
export async function ledger(): Promise<Ledger> {
  const held = envioLedger ?? rpcLedger;
  const settled = held?.source === "envio-hyperrpc" || !envioUrl() || Date.now() - envioFailedAt < TTL_MS;
  if (held && Date.now() - held.at < TTL_MS && settled) return held;
  inflight ??= refresh().finally(() => (inflight = null));
  return inflight;
}

// ---------------------------------------------------------------- views built on the ledger

const lower = (a: string) => a.toLowerCase();
const ZERO = "0x0000000000000000000000000000000000000000";
const dayOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const evKey = (e: Base) => `${e.hash}:${e.logIndex}`;

/** Who is on each tab, from Opened and Claimed. */
function parties(events: TillEvent[]) {
  const map = new Map<string, { payer: Address; payee: Address }>();
  for (const e of events) {
    if (e.name === "Opened") map.set(String(e.id), { payer: e.payer, payee: e.payee });
    if (e.name === "Claimed") {
      const p = map.get(String(e.id));
      if (p) p.payee = e.payee;
    }
  }
  return map;
}

/**
 * Pairs each fee with the open or top-up it was charged on: the same client, an amount whose 1% (rounded up) is
 * the fee, the nearest one within FEE_MATCH_BLOCKS either side. The fee is its own transaction: it used to follow
 * the open, and now goes just before it. A transfer into the treasury that pairs with nothing is not a fee.
 */
function feeTabs(events: TillEvent[], fees: FeeEvent[], who: Map<string, { payer: Address; payee: Address }>) {
  const byPayer = new Map<string, { e: TillEvent; amount: bigint; id: string }[]>();
  for (const e of events) {
    if (e.name !== "Opened" && e.name !== "ToppedUp") continue;
    const payer = who.get(String(e.id))?.payer;
    if (!payer) continue;
    const amount = e.name === "Opened" ? e.budget : e.amount;
    const list = byPayer.get(lower(payer)) ?? [];
    list.push({ e, amount, id: String(e.id) });
    byPayer.set(lower(payer), list);
  }
  const funded = new Set<string>();
  const byFee = new Map<FeeEvent, string>();
  for (const f of fees) {
    let best: { e: TillEvent; id: string } | null = null;
    let gap = Infinity;
    for (const c of byPayer.get(lower(f.from)) ?? []) {
      const d = Math.abs(c.e.block - f.block);
      if (d > FEE_MATCH_BLOCKS || d >= gap || funded.has(evKey(c.e)) || feeFor(c.amount) !== f.amount) continue;
      best = c;
      gap = d;
    }
    if (!best) continue;
    funded.add(evKey(best.e));
    byFee.set(f, best.id);
  }
  return { byFee, funded };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Pay sent, tabs and people for one slice of the network. Money fields are AUSD base units as strings. */
type Slice = { tabs: number; payouts: number; paid: string; clients: number; freelancers: number; wallets: number };

export type Stats = {
  updatedAt: string;
  treasury: Address;
  /**
   * Fees matched to an open or top-up. `refunded` is what the treasury sent back (1% of unspent budget at close,
   * or a fee whose open failed); `net` = total − refunded.
   */
  fees: { total: string; count: number; last7d: string; refunded: string; refunds: number; net: string };
  paid: { total: string; payouts: number; tabs: number; freelancers: number; clients: number };
  /**
   * Tabs opened in the app (through Segundo's relayer) by anyone other than our demo studios, the proof script and
   * the team's own known test wallets (TEAM_WALLETS). Fresh accounts made by our end-to-end scripts can't be told apart.
   */
  outside: Slice;
  /** Tabs opened by the team's own known test wallets (TEAM_WALLETS), apart from the demo studios. */
  team: Slice;
  /** Tabs our demo studios (and the proof script) opened. `studios` and `people` are how many demo wallets we run. */
  demo: Slice & { studios: number; people: number };
  /** Tabs opened straight on the contract, without the app or the relayer (allowed by design; no fee is due). */
  direct: Slice;
  /** The Monad load benchmark's tabs (BENCH_TABS) and wallets: left out of every other figure here. */
  bench: { tabs: number; payouts: number };
  /**
   * Opens and top-ups sent through Segundo since the fee went live (block FEE_BLOCK), and how many of them a fee was
   * matched to. `missed` lists the rest so anyone can check them; `direct` counts those that skipped the app.
   */
  feeRate: { opensWithFee: number; opens: number; direct: number; since: number; missed: { tab: string; kind: "open" | "topup"; block: number; hash: Hex }[] };
  /** Monad's average block time over the last `blocks` blocks, from their timestamps. */
  chain: { blockMs: number; blocks: number; head: number } | null;
  daily: { day: string; paid: string; fees: string; payouts: number; tabs: number }[];
  /** Kept for older readers: the median gap between payouts on a running tab. Not a measure of speed. */
  settle: { medianMs: number | null };
  source: Source;
  /**
   * Why HyperRPC wasn't used for this read (rate limit, timeout, no token). With source "rpc" the counts cover a
   * recent window only; with `asOf` the figures are this instance's last full read, served instead of that window.
   */
  fallback?: string;
  /** Set when HyperRPC didn't answer and this is the last full snapshot this instance holds: when it was read. */
  asOf?: string;
};

const BENCH: ReadonlySet<string> = new Set(BENCH_ADDRESSES.map(lower));
/**
 * Wallets the team runs or used for its own tests, already public in VERIFY.md and the code: the fee-refund check
 * client (tab 124), the two fresh Mera accounts of the first passkey end-to-end runs, and Segundo's own infrastructure
 * (relayer key 0, the CRE loop key, the treasury, the demo payout partner, the faucet wallet). Tabs these open count
 * as the team's, never as outside use.
 */
const TEAM_WALLETS: ReadonlySet<string> = new Set(
  [
    "0xA4980bae43FC09C0ee7B764121E63cCA93b01065",
    "0xca158574f9f167A186C0fe66591081a7072582f3",
    "0xAD7F23EC8C2c6c86e84ED063C525542EA6749d93",
    "0xe77f8062f66767428b1786709E079cABd01ABF40",
    "0x022875424E1556FEC66Fdc5A7D52820dea4dBb8D",
    "0xAdF0F9443EafD19916cBd8f7541ea5e19e69F62c",
    "0x092178787c772cbF67c2560B38D9F4f3454677e6",
    "0xa49d9f84FafA0FeBCBA2F02a3c0EEC75C8957534",
  ].map(lower),
);
const BLOCK_SPAN = 10_000n;
let blockTime: { at: number; v: Stats["chain"] } | null = null;

/** (t(head) − t(head − 10,000)) ÷ 10,000 from the chain itself, kept for ten minutes. */
async function measureBlockTime(): Promise<Stats["chain"]> {
  if (blockTime && Date.now() - blockTime.at < 600_000) return blockTime.v;
  const read = async () => {
    const head = await publicClient.getBlock({ blockTag: "latest" });
    const old = await publicClient.getBlock({ blockNumber: head.number - BLOCK_SPAN });
    return { blockMs: (Number(head.timestamp - old.timestamp) * 1000) / Number(BLOCK_SPAN), blocks: Number(BLOCK_SPAN), head: Number(head.number) };
  };
  const v = await withDeadline(read(), 2_500, "block time").catch(() => null);
  if (v) blockTime = { at: Date.now(), v };
  return v ?? blockTime?.v ?? null;
}

/** The last stats built from a full HyperRPC ledger on this instance, kept for when HyperRPC stops answering. */
let lastFull: Stats | null = null;

/**
 * Network numbers for the landing page and the business case. From HyperRPC they cover every block since
 * deployment. When HyperRPC fails, the last full snapshot this instance built is served with `asOf` (block time
 * kept fresh), rather than the public RPC's few minutes, which would read as no fees and almost no payouts.
 * Only an instance that has never had a full read returns the window, marked `source: "rpc"`.
 */
export async function getStats(): Promise<Stats> {
  const s = await buildStats();
  if (s.source !== "rpc") {
    // A held HyperRPC ledger whose refresh just failed is a full snapshot too, and says so.
    if (envioFailedAt > Date.parse(s.updatedAt)) return { ...s, fallback: envioError ?? "HyperRPC unavailable", asOf: s.updatedAt };
    lastFull = s;
    return s;
  }
  if (!lastFull) return s;
  return { ...lastFull, chain: s.chain ?? lastFull.chain, fallback: s.fallback, asOf: lastFull.updatedAt };
}

async function buildStats(): Promise<Stats> {
  const [l, chain] = await Promise.all([ledger(), measureBlockTime()]);
  const now = Math.floor(Date.now() / 1000);
  const who = parties(l.events);
  // The load benchmark is test traffic: its tabs and wallets are counted on their own and nowhere else.
  const isBench = (id: bigint | string) => {
    const n = Number(id);
    if (n >= BENCH_TABS.from && n <= BENCH_TABS.to) return true;
    const p = who.get(String(id));
    return !!p && (BENCH.has(lower(p.payer)) || BENCH.has(lower(p.payee)));
  };
  const benchEvents = l.events.filter((e) => isBench(e.id));
  const events = l.events.filter((e) => !isBench(e.id));
  const settled = events.filter((e): e is Extract<TillEvent, { name: "Settled" }> => e.name === "Settled");
  const opened = events.filter((e): e is Extract<TillEvent, { name: "Opened" }> => e.name === "Opened");
  const fees = l.fees.filter((f) => l.linked.has(f));

  let paidTotal = settled.reduce((s, e) => s + e.amount, 0n);
  let tabs = opened.length;
  let freelancers = new Set(settled.map((e) => lower(e.payee))).size;
  let clients = new Set(opened.map((e) => lower(e.payer))).size;
  if (l.source === "rpc") {
    const all = await withDeadline(allTabs(), RPC_STATE_MS, "tabs").catch(() => null);
    const views = all?.filter((v) => {
      const n = Number(v.id);
      return !(n >= BENCH_TABS.from && n <= BENCH_TABS.to) && !BENCH.has(lower(v.tab.payer)) && !BENCH.has(lower(v.tab.payee));
    });
    if (views) {
      paidTotal = views.reduce((s, v) => s + v.tab.paid, 0n);
      tabs = views.length;
      freelancers = new Set(views.filter((v) => v.tab.paid > 0n).map((v) => lower(v.tab.payee))).size;
      clients = new Set(views.map((v) => lower(v.tab.payer))).size;
    }
  }

  // Each tab belongs to one slice, by who funded it and how it was opened.
  type Kind = "demo" | "team" | "outside" | "direct";
  const kindOf = new Map<string, Kind>();
  for (const e of opened) {
    const payer = lower(e.payer);
    const k: Kind = DEMO_WALLETS.has(payer) ? "demo" : TEAM_WALLETS.has(payer) ? "team" : l.forwarded.has(lower(e.hash)) ? "outside" : "direct";
    kindOf.set(String(e.id), k);
  }
  const slice = (kind: Kind): Slice => {
    const ids = new Set([...kindOf].filter(([, k]) => k === kind).map(([id]) => id));
    const pays = settled.filter((e) => ids.has(String(e.id)));
    const payers = new Set<string>();
    const payees = new Set<string>();
    for (const id of ids) {
      const p = who.get(id);
      if (!p) continue;
      payers.add(lower(p.payer));
      if (p.payee !== ZERO) payees.add(lower(p.payee));
    }
    // People outside our own wallets: a demo freelancer hired by an outside client is still one of ours, and so is a
    // team test wallet.
    const theirs = (s: Set<string>) =>
      [...s].filter((a) => kind === "demo" || (!DEMO_WALLETS.has(a) && (kind === "team" || !TEAM_WALLETS.has(a))));
    return {
      tabs: ids.size,
      payouts: pays.length,
      paid: pays.reduce((s, e) => s + e.amount, 0n).toString(),
      clients: theirs(payers).length,
      freelancers: theirs(payees).length,
      wallets: new Set([...theirs(payers), ...theirs(payees)]).size,
    };
  };

  // Fee collection since launch: every open and top-up the relayer sent, and whether a fee was matched to it.
  const fundings = events.filter((e) => (e.name === "Opened" || e.name === "ToppedUp") && e.block >= FEE_BLOCK);
  const relayed = fundings.filter((e) => l.forwarded.has(lower(e.hash)));
  const missed = relayed
    .filter((e) => !l.feePaid.has(evKey(e)))
    .map((e) => ({ tab: String((e as { id: bigint }).id), kind: e.name === "Opened" ? ("open" as const) : ("topup" as const), block: e.block, hash: e.hash }));

  const days = new Map<string, { paid: bigint; fees: bigint; payouts: number; tabs: number }>();
  const day = (t: number) => {
    const d = dayOf(t);
    let row = days.get(d);
    if (!row) days.set(d, (row = { paid: 0n, fees: 0n, payouts: 0, tabs: 0 }));
    return row;
  };
  for (const e of settled) {
    const r = day(e.time);
    r.paid += e.amount;
    r.payouts++;
  }
  for (const e of opened) day(e.time).tabs++;
  for (const f of fees) day(f.time).fees += f.amount;
  // Every day from the first with activity to today, quiet days included, so a chart reads true.
  const first = [...days.keys()].sort()[0];
  const daily: Stats["daily"] = [];
  if (first) {
    for (let t = Date.parse(`${first}T00:00:00Z`) / 1000; t <= now; t += 86_400) {
      const d = dayOf(t);
      const r = days.get(d) ?? { paid: 0n, fees: 0n, payouts: 0, tabs: 0 };
      daily.push({ day: d, paid: r.paid.toString(), fees: r.fees.toString(), payouts: r.payouts, tabs: r.tabs });
    }
  }

  // The median gap between one payout and the next on the same tab within a shift (gaps across a clock-out, or
  // longer than ten minutes, are left out). It mostly measures how often someone is watching, so no page shows it.
  const gaps: number[] = [];
  const lastPay = new Map<string, number>();
  for (const e of events) {
    const id = String(e.id);
    if (e.name === "ClockedIn" || e.name === "ClockedOut" || e.name === "Closed") lastPay.delete(id);
    if (e.name !== "Settled") continue;
    const prev = lastPay.get(id);
    if (prev != null && e.time > prev && e.time - prev <= 600) gaps.push((e.time - prev) * 1000);
    lastPay.set(id, e.time);
  }

  // Refunds go back to clients who paid a fee; anything else leaving the treasury isn't a fee refund.
  const feePayers = new Set(fees.map((f) => lower(f.from)));
  const refunds = l.refunds.filter((r) => feePayers.has(lower(r.to)));
  const feeTotal = fees.reduce((s, f) => s + f.amount, 0n);
  const refunded = refunds.reduce((s, r) => s + r.amount, 0n);
  const fees7 = fees.filter((f) => f.time >= now - 7 * 86_400).reduce((s, f) => s + f.amount, 0n);
  const demo = slice("demo");
  return {
    updatedAt: new Date(l.at).toISOString(),
    treasury: TREASURY,
    fees: {
      total: feeTotal.toString(),
      count: fees.length,
      last7d: fees7.toString(),
      refunded: refunded.toString(),
      refunds: refunds.length,
      net: (feeTotal - refunded).toString(),
    },
    paid: { total: paidTotal.toString(), payouts: settled.length, tabs, freelancers, clients },
    outside: slice("outside"),
    team: slice("team"),
    demo: { ...demo, studios: DEMO_CLIENTS.length, people: DEMO_FREELANCERS.length },
    direct: slice("direct"),
    bench: { tabs: benchEvents.filter((e) => e.name === "Opened").length, payouts: benchEvents.filter((e) => e.name === "Settled").length },
    feeRate: { opensWithFee: relayed.length - missed.length, opens: relayed.length, direct: fundings.length - relayed.length, since: FEE_BLOCK, missed },
    chain,
    daily,
    settle: { medianMs: median(gaps) },
    source: l.source,
    ...(l.source === "rpc" ? { fallback: envioUrl() ? (envioError ?? "HyperRPC unavailable") : "no ENVIO_API_TOKEN" } : {}),
  };
}

async function allTabs(): Promise<TabView[]> {
  const count = (await publicClient.readContract({ address: TILL_ADDRESS, abi: tillAbi, functionName: "tabCount" })) as bigint;
  return readTabs(Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1)));
}

export type HistoryKind = "opened" | "paid" | "closed" | "refund" | "fee" | "topup" | "clockIn" | "clockOut";
export type HistoryItem = {
  kind: HistoryKind;
  /** Tab number as a string; for a fee, the tab it was charged on when that can be matched, else null. */
  tab: string | null;
  /** AUSD base units (6 dp) as a decimal string; null for clock-ins and clock-outs. */
  amount: string | null;
  block: number;
  /** Unix seconds. */
  time: number;
  hash: Hex;
  /** The other side: the client on a freelancer's line, the freelancer on a client's, the treasury for a fee. */
  counterparty: Address | null;
  /** Which side of the tab this address is on, so a payout reads as income or as spending. */
  role: "freelancer" | "client";
};
export type History = {
  address: Address;
  items: HistoryItem[];
  /** feesRefunded: fee refunds the treasury sent back to this address (not part of the shared contract's required fields). */
  totals: { earned: string; paidOut: string; fees: string; feesRefunded?: string };
  /** Not part of the shared contract's required fields; tells a page how far back the items reach. */
  source: Source;
  fromBlock: number;
  head: number;
};

/**
 * One person's pay history, newest first: tabs they opened or were paid on, every payout, refunds, top-ups, clock
 * events and the fees they paid. earned = payouts received; paidOut = payouts made from tabs they fund.
 */
export async function getHistory(address: Address): Promise<History> {
  const l = await ledger();
  const me = lower(address);
  const who = parties(l.events);
  const mine = new Set([...who].filter(([, p]) => lower(p.payer) === me || lower(p.payee) === me).map(([id]) => id));
  const items: HistoryItem[] = [];
  let earned = 0n;
  let paidOut = 0n;
  let feesPaid = 0n;

  for (const e of l.events) {
    const id = String(e.id);
    const p = who.get(id);
    if (!mine.has(id) || !p) continue;
    const amPayer = lower(p.payer) === me;
    const other = amPayer ? (p.payee === ZERO ? null : p.payee) : p.payer;
    const line = { tab: id, block: e.block, time: e.time, hash: e.hash, counterparty: other, role: amPayer ? ("client" as const) : ("freelancer" as const) };
    switch (e.name) {
      case "Opened":
        items.push({ ...line, kind: "opened", amount: e.budget.toString() });
        break;
      case "ToppedUp":
        items.push({ ...line, kind: "topup", amount: e.amount.toString() });
        break;
      case "ClockedIn":
        items.push({ ...line, kind: "clockIn", amount: null });
        break;
      case "ClockedOut":
        items.push({ ...line, kind: "clockOut", amount: null });
        break;
      case "Settled":
        if (lower(e.payee) === me) earned += e.amount;
        if (amPayer) paidOut += e.amount;
        items.push({ ...line, kind: "paid", amount: e.amount.toString(), counterparty: amPayer ? e.payee : p.payer });
        break;
      case "Closed":
        items.push({ ...line, kind: "closed", amount: e.paid.toString() });
        if (amPayer && e.refunded > 0n) items.push({ ...line, kind: "refund", amount: e.refunded.toString() });
        break;
    }
  }
  // Only transfers paired with an open or top-up are fees; the pairing is built once per ledger refresh.
  for (const f of l.fees) {
    const tab = l.linked.get(f);
    if (tab === undefined || lower(f.from) !== me) continue;
    feesPaid += f.amount;
    items.push({ kind: "fee", tab, amount: f.amount.toString(), block: f.block, time: f.time, hash: f.hash, counterparty: TREASURY, role: "client" });
  }
  const feesRefunded = feesPaid > 0n ? l.refunds.filter((r) => lower(r.to) === me).reduce((s, r) => s + r.amount, 0n) : 0n;

  // The fallback window can't sum a whole history; contract state can (each tab keeps what it has paid).
  if (l.source === "rpc") {
    const read = async () => {
      const ids = (await publicClient.readContract({ address: TILL_ADDRESS, abi: tillAbi, functionName: "tabsOf", args: [address] })) as readonly bigint[];
      return readTabs([...ids]);
    };
    const views = await withDeadline(read(), RPC_STATE_MS, "tabs").catch(() => null);
    if (views) {
      earned = views.filter((v) => lower(v.tab.payee) === me).reduce((s, v) => s + v.tab.paid, 0n);
      paidOut = views.filter((v) => lower(v.tab.payer) === me).reduce((s, v) => s + v.tab.paid, 0n);
    }
  }

  // Newest first; within a block, the reverse of the order the contract emitted them (refund after close after payout).
  const seq = new Map(items.map((it, i) => [it, i]));
  items.sort((a, b) => b.block - a.block || seq.get(b)! - seq.get(a)!);
  return {
    address,
    items,
    totals: { earned: earned.toString(), paidOut: paidOut.toString(), fees: feesPaid.toString(), feesRefunded: feesRefunded.toString() },
    source: l.source,
    fromBlock: Number(l.from),
    head: Number(l.head),
  };
}
