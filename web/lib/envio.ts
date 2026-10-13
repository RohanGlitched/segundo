import "server-only";
import { decodeEventLog, encodeEventTopics, getAddress, pad, type Address, type Hex } from "viem";
import { tillAbi } from "./abi";
import { DOLLAR, RPC_URL, TILL, TREASURY, publicClient } from "./chain";
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

const TTL_MS = 60_000;
/** HyperRPC: blocks per log query. A query that times out is split in half and tried again. */
const ENVIO_SPAN = 400_000n;
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

type Ledger = {
  source: Source;
  /** Last block read, inclusive. */
  head: bigint;
  /** First block read: the deployment block for HyperRPC, the start of the recent window for the public RPC. */
  from: bigint;
  events: TillEvent[];
  fees: FeeEvent[];
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

const envioUrl = () => {
  const token = process.env.ENVIO_API_TOKEN?.trim();
  return token ? `https://monad-testnet.rpc.hypersync.xyz/${token}` : null;
};

/** One JSON-RPC call with a hard timeout. Errors carry the method, never the URL. */
async function call<T>(url: string, method: string, params: unknown[], ms: number): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(ms),
      cache: "no-store",
    });
  } catch (e) {
    throw new Error(`${method}: ${e instanceof Error && e.name === "TimeoutError" ? "timed out" : "unreachable"}`);
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

type Filter = { address: Address; topics: (Hex | Hex[] | null)[] };

/** HyperRPC: big ranges, split in half whenever one is too heavy to answer in time. */
async function envioLogs(url: string, filter: Filter, from: bigint, to: bigint): Promise<RawLog[]> {
  const ranges: [bigint, bigint][] = [];
  for (let a = from; a <= to; a += ENVIO_SPAN) ranges.push([a, a + ENVIO_SPAN - 1n > to ? to : a + ENVIO_SPAN - 1n]);
  const one = async (a: bigint, b: bigint): Promise<RawLog[]> => {
    try {
      return await call<RawLog[]>(url, "eth_getLogs", [{ ...filter, fromBlock: hex(a), toBlock: hex(b) }], 9_000);
    } catch (e) {
      if (b - a < ENVIO_MIN_SPAN) throw e;
      const mid = a + (b - a) / 2n;
      const [x, y] = await Promise.all([one(a, mid), one(mid + 1n, b)]);
      return [...x, ...y];
    }
  };
  return (await pool(ranges.map(([a, b]) => () => one(a, b)), 4)).flat();
}

/** Public RPC: 100-block pages over a short window. */
async function rpcLogs(filter: Filter, from: bigint, to: bigint): Promise<RawLog[]> {
  const tasks: (() => Promise<RawLog[]>)[] = [];
  for (let a = from; a <= to; a += RPC_SPAN) {
    const b = a + RPC_SPAN - 1n > to ? to : a + RPC_SPAN - 1n;
    tasks.push(() => call<RawLog[]>(RPC_URL, "eth_getLogs", [{ ...filter, fromBlock: hex(a), toBlock: hex(b) }], 4_000));
  }
  return (await pool(tasks, 6)).flat();
}

/** Several JSON-RPC calls in one POST (HyperRPC answers batches of 50 block reads in a second or two). */
async function batch<T>(url: string, method: string, params: unknown[][], ms: number): Promise<(T | null)[]> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params.map((p, id) => ({ jsonrpc: "2.0", id, method, params: p }))),
    signal: AbortSignal.timeout(ms),
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
async function fillTimes(logs: RawLog[], url: string, known: [number, number][]) {
  const missing = [...new Set(logs.filter((l) => !l.blockTimestamp).map((l) => l.blockNumber))];
  if (!missing.length) return;
  const times = new Map<string, Hex>();
  const groups: string[][] = [];
  for (let i = 0; i < missing.length; i += 50) groups.push(missing.slice(i, i + 50));
  const stop = Date.now() + 9_000;
  await pool(
    groups.map((g) => async () => {
      if (Date.now() > stop) return;
      const blocks = await batch<{ timestamp: Hex }>(url, "eth_getBlockByNumber", g.map((n) => [n, false]), 6_000);
      blocks.forEach((b, i) => b && times.set(g[i], b.timestamp));
    }),
    4,
  );
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

function decodeFee(l: RawLog): FeeEvent | null {
  if (l.topics.length < 3) return null;
  return {
    block: Number(l.blockNumber),
    time: Number(l.blockTimestamp ?? 0),
    hash: l.transactionHash,
    logIndex: Number(l.logIndex),
    from: getAddress(`0x${l.topics[1].slice(26)}`),
    amount: BigInt(l.data),
  };
}

const keyOf = (l: RawLog) => `${l.transactionHash}:${Number(l.logIndex)}`;
const order = (a: Base, b: Base) => a.block - b.block || a.logIndex - b.logIndex;

/** Reads [from, to] from one provider and folds it into a ledger (new or existing), skipping logs already held. */
async function scan(source: Source, from: bigint, to: bigint, into?: Ledger): Promise<Ledger> {
  const url = source === "envio-hyperrpc" ? envioUrl()! : RPC_URL;
  const read = source === "envio-hyperrpc" ? (f: Filter) => envioLogs(url, f, from, to) : (f: Filter) => rpcLogs(f, from, to);
  const [tillLogs, feeLogs] = await Promise.all([
    read({ address: TILL_ADDRESS, topics: [TILL_TOPICS] }),
    read({ address: DOLLAR, topics: [TRANSFER_TOPIC, null, TREASURY_TOPIC] }),
  ]);
  const known: [number, number][] = into ? [...into.events, ...into.fees].slice(-50).map((e) => [e.block, e.time]) : [];
  await fillTimes([...tillLogs, ...feeLogs], url, known);
  const ledger: Ledger = into ?? { source, head: to, from, events: [], fees: [], keys: new Set(), at: Date.now() };
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
    const f = decodeFee(l);
    if (!f) continue;
    ledger.keys.add(k);
    ledger.fees.push(f);
  }
  ledger.events.sort(order);
  ledger.fees.sort(order);
  ledger.head = to > ledger.head ? to : ledger.head;
  ledger.at = Date.now();
  return ledger;
}

let envioLedger: Ledger | null = null;
let rpcLedger: Ledger | null = null;
let inflight: Promise<Ledger> | null = null;
/** After HyperRPC fails with nothing held, the fallback is used for a minute before HyperRPC is tried again. */
let envioFailedAt = 0;

const withDeadline = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what}: over ${ms} ms`)), ms))]);

async function refresh(): Promise<Ledger> {
  const envio = envioUrl();
  if (envio) {
    try {
      // HyperRPC's own head, so a range never runs past the block it has indexed.
      const tip = BigInt(await call<Hex>(envio, "eth_blockNumber", [], 4_000));
      if (envioLedger) {
        // A few blocks of overlap; logs already held are skipped by key.
        const from = envioLedger.head > 5n ? envioLedger.head - 5n : 0n;
        if (tip > envioLedger.head) await withDeadline(scan("envio-hyperrpc", from, tip, envioLedger), 8_000, "HyperRPC refresh");
        envioLedger.at = Date.now();
        return envioLedger;
      }
      envioLedger = await withDeadline(scan("envio-hyperrpc", DEPLOY_BLOCK, tip), 25_000, "HyperRPC first read");
      return envioLedger;
    } catch (e) {
      console.warn("envio:", e instanceof Error ? e.message : "failed");
      envioFailedAt = Date.now();
      // A full ledger a minute old beats a short window: keep serving it and try again on the next request.
      if (envioLedger) return envioLedger;
    }
  }
  const tip = await withDeadline(publicClient.getBlockNumber({ cacheTime: 0 }), RPC_TIP_MS, "block number");
  const from = tip > RPC_WINDOW ? tip - RPC_WINDOW + 1n : 0n;
  rpcLedger = await withDeadline(scan("rpc", from, tip), RPC_WINDOW_MS, "RPC window");
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
 * the fee, the nearest one at or before the fee's block. The fee is its own transaction, sent right after.
 */
function feeTabs(events: TillEvent[], fees: FeeEvent[], who: Map<string, { payer: Address; payee: Address }>) {
  const used = new Set<string>();
  const out = new Map<FeeEvent, string>();
  const funding = events.filter((e) => e.name === "Opened" || e.name === "ToppedUp");
  for (const f of fees) {
    for (let i = funding.length - 1; i >= 0; i--) {
      const e = funding[i];
      if (e.block > f.block || f.block - e.block > 600) continue;
      const k = `${e.hash}:${e.logIndex}`;
      if (used.has(k)) continue;
      const amount = e.name === "Opened" ? e.budget : e.name === "ToppedUp" ? e.amount : 0n;
      const payer = who.get(String(e.id))?.payer;
      if (!payer || lower(payer) !== lower(f.from) || feeFor(amount) !== f.amount) continue;
      used.add(k);
      out.set(f, String(e.id));
      break;
    }
  }
  return out;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export type Stats = {
  updatedAt: string;
  treasury: Address;
  fees: { total: string; count: number; last7d: string };
  paid: { total: string; payouts: number; tabs: number; freelancers: number; clients: number };
  daily: { day: string; paid: string; fees: string; payouts: number; tabs: number }[];
  settle: { medianMs: number | null };
  source: Source;
};

/**
 * Network numbers for the landing page and the business case. From HyperRPC they cover every block since
 * deployment. From the public RPC fallback, the all-time totals come from contract state (getTabs) and the
 * counts, fees and daily rows only from the recent window.
 */
export async function getStats(): Promise<Stats> {
  const l = await ledger();
  const now = Math.floor(Date.now() / 1000);
  const settled = l.events.filter((e): e is Extract<TillEvent, { name: "Settled" }> => e.name === "Settled");
  const opened = l.events.filter((e): e is Extract<TillEvent, { name: "Opened" }> => e.name === "Opened");

  let paidTotal = settled.reduce((s, e) => s + e.amount, 0n);
  let tabs = opened.length;
  let freelancers = new Set(settled.map((e) => lower(e.payee))).size;
  let clients = new Set(opened.map((e) => lower(e.payer))).size;
  if (l.source === "rpc") {
    const views = await withDeadline(allTabs(), RPC_STATE_MS, "tabs").catch(() => null);
    if (views) {
      paidTotal = views.reduce((s, v) => s + v.tab.paid, 0n);
      tabs = views.length;
      freelancers = new Set(views.filter((v) => v.tab.paid > 0n).map((v) => lower(v.tab.payee))).size;
      clients = new Set(views.map((v) => lower(v.tab.payer))).size;
    }
  }

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
  for (const f of l.fees) day(f.time).fees += f.amount;
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

  // How often pay lands on a running tab: the median gap between one payout and the next on the same tab
  // within a shift (gaps across a clock-out, or longer than ten minutes, are left out).
  const gaps: number[] = [];
  const lastPay = new Map<string, number>();
  for (const e of l.events) {
    const id = String(e.id);
    if (e.name === "ClockedIn" || e.name === "ClockedOut" || e.name === "Closed") lastPay.delete(id);
    if (e.name !== "Settled") continue;
    const prev = lastPay.get(id);
    if (prev != null && e.time > prev && e.time - prev <= 600) gaps.push((e.time - prev) * 1000);
    lastPay.set(id, e.time);
  }

  const fees = l.fees.reduce((s, f) => s + f.amount, 0n);
  const fees7 = l.fees.filter((f) => f.time >= now - 7 * 86_400).reduce((s, f) => s + f.amount, 0n);
  return {
    updatedAt: new Date(l.at).toISOString(),
    treasury: TREASURY,
    fees: { total: fees.toString(), count: l.fees.length, last7d: fees7.toString() },
    paid: { total: paidTotal.toString(), payouts: settled.length, tabs, freelancers, clients },
    daily,
    settle: { medianMs: median(gaps) },
    source: l.source,
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
  totals: { earned: string; paidOut: string; fees: string };
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
  const linked = feeTabs(l.events, l.fees, who);
  for (const f of l.fees) {
    if (lower(f.from) !== me) continue;
    feesPaid += f.amount;
    items.push({ kind: "fee", tab: linked.get(f) ?? null, amount: f.amount.toString(), block: f.block, time: f.time, hash: f.hash, counterparty: TREASURY, role: "client" });
  }

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
    totals: { earned: earned.toString(), paidOut: paidOut.toString(), fees: feesPaid.toString() },
    source: l.source,
    fromBlock: Number(l.from),
    head: Number(l.head),
  };
}
