import "server-only";
import { decodeEventLog, encodeEventTopics, getAddress, hexToString, isAddress, type Address, type Hex } from "viem";
import { RPC_URL, publicClient } from "./chain";
import { KEEPER_ADDRESS } from "./money";

/**
 * Segundo's Chainlink CRE keeper, read back from Monad.
 *
 * A CRE workflow (cre/) settles running tabs and posts USD exchange rates to SegundoKeeper. Today the workflow runs
 * in the CRE CLI simulator with `--broadcast`, so its reports reach SegundoKeeper through Chainlink's
 * MockKeystoneForwarder, which checks no signatures: on testnet anyone can call it and post rates. The contract's
 * own `allRates` is therefore not trusted. This module reads the `RatesPosted` logs instead and keeps only reports
 *
 *   - sent by one of Segundo's reporting keys (`CRE_REPORTERS`: the CRE loop key, plus the keeper key that signed the
 *     first broadcasts), checked against the transaction's `from`, and
 *   - dated no later than their block (report time `at` at most CRE_FUTURE_SLACK_SECONDS past the block timestamp).
 *
 * The newest trusted report gives the rates, its block and its transaction; it counts as fresh while under
 * CRE_FRESH_SECONDS old, after which /api/fx falls back to the reference rate. Logs come from Envio HyperRPC (every
 * event since the keeper was deployed, in one call); without it, the public RPC finds the newest report's block
 * from its timestamp.
 */

/** SegundoKeeper on Monad testnet (cre/README.md; Sourcify exact match). */
export const KEEPER: Address = KEEPER_ADDRESS;
/** Block of the keeper's deployment (tx 0xcce52a96…); nothing older can hold its events. */
export const KEEPER_DEPLOY_BLOCK = 70_682_832n;
/** The currencies the workflow posts. */
export const CRE_CURRENCIES = ["PHP", "NGN", "INR", "BRL", "KES", "EUR"] as const;
/** A report older than this no longer counts as today's rate: the app falls back to its reference rate. */
export const CRE_FRESH_SECONDS = 6 * 60 * 60;
/** How far a report's time may run ahead of its block's timestamp before it is ignored as future-dated. */
export const CRE_FUTURE_SLACK_SECONDS = 5 * 60;

/**
 * Keys whose reports the app trusts. Default: the CRE loop's own key (scripts/cre-loop.sh, keys/cre.json) and the
 * keeper key that signed the first broadcasts (cre/SIMULATION.md). Override with CRE_REPORTERS (comma-separated).
 */
const DEFAULT_REPORTERS = ["0x022875424E1556FEC66Fdc5A7D52820dea4dBb8D", "0xe77f8062f66767428b1786709E079cABd01ABF40"];
export const CRE_REPORTERS: Address[] = (() => {
  const list = (process.env.CRE_REPORTERS?.split(",") ?? DEFAULT_REPORTERS).map((a) => a.trim()).filter((a) => isAddress(a));
  return (list.length ? list : DEFAULT_REPORTERS).map((a) => getAddress(a));
})();
const reporters = new Set(CRE_REPORTERS.map((a) => a.toLowerCase()));

export const keeperAbi = [
  { type: "function", name: "reports", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalPaid", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lastReportAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  {
    type: "function",
    name: "rateOf",
    stateMutability: "view",
    inputs: [{ name: "currency", type: "bytes3" }],
    outputs: [
      { name: "rateE6", type: "uint64" },
      { name: "at", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "allRates",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "currencies", type: "bytes3[]" },
      { name: "ratesE6", type: "uint64[]" },
      { name: "ats", type: "uint64[]" },
    ],
  },
  {
    type: "event",
    name: "RatesPosted",
    inputs: [
      { name: "at", type: "uint64", indexed: true },
      { name: "currencies", type: "bytes3[]", indexed: false },
      { name: "ratesE6", type: "uint64[]", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Kept",
    inputs: [
      { name: "at", type: "uint64", indexed: true },
      { name: "tabs", type: "uint256", indexed: false },
      { name: "paid", type: "uint256", indexed: false },
    ],
  },
] as const;

export type CreRate = { cur: string; rateE6: number; at: number };
export type Cre = {
  keeper: Address;
  /** Reports the keeper has processed (stale and untrusted ones included). */
  reports: number;
  /** Block and transaction of the newest trusted RatesPosted; null if none was found. */
  lastBlock: number | null;
  lastTx: Hex | null;
  /** Report time (unix seconds, the workflow's clock) of the newest trusted rates. */
  lastAt: number | null;
  /** Tabs settled across every report (sum of Kept.tabs); null when only the public RPC answered. */
  tabsSettledTotal: number | null;
  /** AUSD base units (6 dp) paid to freelancers through the keeper, as a string. */
  paidTotal: string;
  /** Rates from the newest trusted report. */
  rates: CreRate[];
  /** True when the newest trusted rates are younger than CRE_FRESH_SECONDS. */
  fresh: boolean;
  /** The keys whose reports count. */
  reporters: Address[];
  /** RatesPosted logs this server has looked at and ignored (wrong sender or future-dated). */
  ignoredReports: number;
  source: "envio-hyperrpc" | "rpc";
  updatedAt: number;
};

type RawLog = { blockNumber: Hex; transactionHash: Hex; logIndex: Hex; topics: Hex[]; data: Hex };
type Posted = { block: number; tx: Hex; at: number; rates: CreRate[] };

const TTL_MS = 60_000;
const TOPICS = (["RatesPosted", "Kept"] as const).map((eventName) => encodeEventTopics({ abi: keeperAbi, eventName })[0] as Hex);
const hex = (n: bigint) => `0x${n.toString(16)}`;
const cur3 = (b: Hex) => hexToString(b).replace(/\0+$/, "");
const isFresh = (at: number | null) => at != null && Date.now() / 1000 - at < CRE_FRESH_SECONDS;

const envioUrl = () => {
  const token = process.env.ENVIO_API_TOKEN?.trim();
  return token ? `https://monad-testnet.rpc.hypersync.xyz/${token}` : null;
};

/** One JSON-RPC call with a hard timeout. Errors carry the method, never the URL (the HyperRPC URL holds a token). */
async function call<T>(url: string, method: string, params: unknown[], ms: number): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(ms),
    cache: "no-store",
  }).catch(() => {
    throw new Error(`${method}: unreachable`);
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message ?? "error"}`);
  return body.result as T;
}

/** A RatesPosted log, decoded; null for anything else. */
function decodePosted(l: RawLog): Posted | null {
  const ev = decodeEventLog({ abi: keeperAbi, topics: l.topics as [Hex, ...Hex[]], data: l.data });
  if (ev.eventName !== "RatesPosted") return null;
  const at = Number(ev.args.at);
  const rates = ev.args.currencies.map((c, i) => ({ cur: cur3(c), rateE6: Number(ev.args.ratesE6[i] ?? 0n), at })).filter((r) => r.cur && r.rateE6 > 0);
  return { block: Number(l.blockNumber), tx: l.transactionHash, at, rates };
}

/** Verdict per transaction hash, so each report costs one transaction and one block lookup per server instance. */
const verdicts = new Map<Hex, boolean>();
let ignored = 0;

/** True when the report's transaction came from a reporting key and its report time isn't ahead of its block. */
async function trusted(p: Posted): Promise<boolean> {
  const known = verdicts.get(p.tx);
  if (known !== undefined) return known;
  const [tx, block] = await Promise.all([publicClient.getTransaction({ hash: p.tx }), publicClient.getBlock({ blockNumber: BigInt(p.block) })]);
  const ok = reporters.has(tx.from.toLowerCase()) && p.at <= Number(block.timestamp) + CRE_FUTURE_SLACK_SECONDS;
  verdicts.set(p.tx, ok);
  if (!ok) ignored += 1;
  return ok;
}

/** The newest trusted report this instance has seen, from either path. */
let best: Posted | null = null;
const newer = (a: Posted, b: Posted | null) => !b || a.block > b.block || (a.block === b.block && a.at > b.at);

/**
 * Judges candidate reports newest first and keeps the first trusted one; older candidates can't beat it, so they
 * are never looked up. A flood of untrusted reports costs lookups only down to the newest trusted one.
 */
async function judge(candidates: Posted[]) {
  const fresh = candidates.filter((p) => newer(p, best)).sort((a, b) => b.block - a.block || b.at - a.at);
  for (const p of fresh) {
    if (await trusted(p)) {
      best = p;
      return;
    }
  }
}

/** Every Kept and RatesPosted since the last read, kept per server instance so later reads only ask for new blocks. */
const seen = { to: KEEPER_DEPLOY_BLOCK - 1n, tabs: 0, keys: new Set<string>(), pending: [] as Posted[] };

async function readLogsEnvio(url: string, head: bigint) {
  if (head > seen.to) {
    const logs = await call<RawLog[]>(url, "eth_getLogs", [{ address: KEEPER, topics: [TOPICS], fromBlock: hex(seen.to + 1n), toBlock: hex(head) }], 9_000);
    for (const l of logs) {
      const key = `${l.transactionHash}:${l.logIndex}`;
      if (seen.keys.has(key)) continue;
      seen.keys.add(key);
      const posted = decodePosted(l);
      if (posted) seen.pending.push(posted);
      else {
        const ev = decodeEventLog({ abi: keeperAbi, topics: l.topics as [Hex, ...Hex[]], data: l.data });
        if (ev.eventName === "Kept") seen.tabs += Number(ev.args.tabs);
      }
    }
    seen.to = head;
  }
  // Judged reports leave the queue; one whose lookup failed stays for the next read.
  const queue = seen.pending;
  await judge(queue);
  seen.pending = queue.filter((p) => newer(p, best) && !verdicts.has(p.tx));
}

/**
 * Without HyperRPC: the public RPC answers logs 100 blocks at a time, so find the first block at or after the
 * report's time by bisection, then look a few hundred blocks past it for the RatesPosted it emitted.
 */
async function findPostedRpc(at: number, head: bigint): Promise<Posted | null> {
  let lo = KEEPER_DEPLOY_BLOCK;
  let hi = head;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const b = await publicClient.getBlock({ blockNumber: mid });
    if (Number(b.timestamp) < at) lo = mid + 1n;
    else hi = mid;
  }
  const atTopic = encodeEventTopics({ abi: keeperAbi, eventName: "RatesPosted", args: { at: BigInt(at) } });
  for (let a = lo; a <= head && a < lo + 600n; a += 100n) {
    const b = a + 99n > head ? head : a + 99n;
    const logs = await call<RawLog[]>(RPC_URL, "eth_getLogs", [{ address: KEEPER, topics: atTopic, fromBlock: hex(a), toBlock: hex(b) }], 4_000);
    const l = logs.at(-1);
    if (l) return decodePosted(l);
  }
  return null;
}

/** lastReportAt values already searched for on the public RPC, so a quiet keeper isn't bisected every minute. */
const searched = new Set<number>();

async function read(): Promise<Cre> {
  const [reports, totalPaid, lastReportAt, head] = await Promise.all([
    publicClient.readContract({ address: KEEPER, abi: keeperAbi, functionName: "reports" }),
    publicClient.readContract({ address: KEEPER, abi: keeperAbi, functionName: "totalPaid" }),
    publicClient.readContract({ address: KEEPER, abi: keeperAbi, functionName: "lastReportAt" }),
    publicClient.getBlockNumber(),
  ]);

  let source: Cre["source"] = "rpc";
  let tabs: number | null = null;
  const url = envioUrl();
  if (url) {
    try {
      await readLogsEnvio(url, head);
      source = "envio-hyperrpc";
      tabs = seen.tabs;
    } catch {
      // Fall through to the public RPC below.
    }
  }
  const lastReport = Number(lastReportAt);
  if (source === "rpc" && lastReport > 0 && !searched.has(lastReport) && (!best || best.at < lastReport)) {
    // Only the keeper's newest report can be located cheaply. If it isn't trusted, the newest trusted report this
    // instance already knows stands (or none, and /api/fx uses the reference rate) until the loop posts again.
    const posted = await findPostedRpc(lastReport, head).catch(() => null);
    if (posted) {
      await judge([posted])
        .then(() => searched.add(lastReport))
        .catch(() => undefined);
    }
  }

  return {
    keeper: KEEPER,
    reports: Number(reports),
    lastBlock: best?.block ?? null,
    lastTx: best?.tx ?? null,
    lastAt: best?.at ?? null,
    tabsSettledTotal: tabs,
    paidTotal: totalPaid.toString(),
    rates: best?.rates ?? [],
    fresh: isFresh(best?.at ?? null),
    reporters: CRE_REPORTERS,
    ignoredReports: ignored,
    source,
    updatedAt: Date.now(),
  };
}

let cache: { at: number; value: Cre } | null = null;
let pending: Promise<Cre> | null = null;

/** The keeper's state, at most a minute old; concurrent callers share one read. */
export async function getCre(): Promise<Cre> {
  if (cache && Date.now() - cache.at < TTL_MS) return { ...cache.value, fresh: isFresh(cache.value.lastAt) };
  pending ??= read()
    .then((value) => {
      cache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
