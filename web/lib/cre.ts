import "server-only";
import { decodeEventLog, encodeEventTopics, hexToString, type Address, type Hex } from "viem";
import { RPC_URL, publicClient } from "./chain";
import { KEEPER_ADDRESS } from "./money";

/**
 * Segundo's Chainlink CRE keeper, read back from Monad.
 *
 * A CRE workflow (till/cre) settles running tabs and posts the USD exchange rates its DON agreed on to SegundoKeeper.
 * This module reads that contract: the latest rate per currency and when it was agreed (`allRates`), how many
 * reports have landed and what they paid, and the block of the newest `RatesPosted`, so a page can say exactly
 * which block a rate came from. Logs come from Envio HyperRPC (every event since the keeper was deployed, in one
 * call); without it, the public RPC finds the newest report's block from its timestamp.
 */

/** SegundoKeeper on Monad testnet (cre/README.md; Sourcify exact match). */
export const KEEPER: Address = KEEPER_ADDRESS;
/** Block of the keeper's deployment (tx 0xcce52a96…); nothing older can hold its events. */
export const KEEPER_DEPLOY_BLOCK = 70_682_832n;
/** The currencies the workflow posts. */
export const CRE_CURRENCIES = ["PHP", "NGN", "INR", "BRL", "KES", "EUR"] as const;
/** A report older than this no longer counts as today's rate: the app falls back to its reference rate. */
export const CRE_FRESH_SECONDS = 6 * 60 * 60;

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
  /** Reports the keeper has processed (stale ones included). */
  reports: number;
  /** Block and transaction of the newest RatesPosted; null if it couldn't be found. */
  lastBlock: number | null;
  lastTx: Hex | null;
  /** DON time (unix seconds) of the newest posted rates. */
  lastAt: number | null;
  /** Tabs settled across every report (sum of Kept.tabs); null when only the public RPC answered. */
  tabsSettledTotal: number | null;
  /** AUSD base units (6 dp) paid to freelancers through the keeper, as a string. */
  paidTotal: string;
  rates: CreRate[];
  /** True when the newest rates are younger than CRE_FRESH_SECONDS. */
  fresh: boolean;
  source: "envio-hyperrpc" | "rpc";
  updatedAt: number;
};

type RawLog = { blockNumber: Hex; transactionHash: Hex; logIndex: Hex; topics: Hex[]; data: Hex };
type Posted = { block: number; tx: Hex; at: number };

const TTL_MS = 60_000;
const TOPICS = (["RatesPosted", "Kept"] as const).map((eventName) => encodeEventTopics({ abi: keeperAbi, eventName })[0] as Hex);
const hex = (n: bigint) => `0x${n.toString(16)}`;
const cur3 = (b: Hex) => hexToString(b).replace(/\0+$/, "");

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

/** Every RatesPosted and Kept since the last read, kept per server instance so later reads only ask for new blocks. */
const seen = { to: KEEPER_DEPLOY_BLOCK - 1n, posted: null as Posted | null, tabs: 0, keys: new Set<string>() };

async function readLogsEnvio(url: string, head: bigint) {
  if (head <= seen.to) return;
  const logs = await call<RawLog[]>(url, "eth_getLogs", [{ address: KEEPER, topics: [TOPICS], fromBlock: hex(seen.to + 1n), toBlock: hex(head) }], 9_000);
  for (const l of logs) {
    const key = `${l.transactionHash}:${l.logIndex}`;
    if (seen.keys.has(key)) continue;
    seen.keys.add(key);
    const ev = decodeEventLog({ abi: keeperAbi, topics: l.topics as [Hex, ...Hex[]], data: l.data });
    const block = Number(l.blockNumber);
    if (ev.eventName === "Kept") seen.tabs += Number(ev.args.tabs);
    else if (!seen.posted || block >= seen.posted.block) seen.posted = { block, tx: l.transactionHash, at: Number(ev.args.at) };
  }
  seen.to = head;
}

/**
 * Without HyperRPC: the public RPC answers logs 100 blocks at a time, so find the first block at or after the
 * report's DON time by bisection, then look a few hundred blocks past it for the RatesPosted it emitted.
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
    if (l) return { block: Number(l.blockNumber), tx: l.transactionHash, at };
  }
  return null;
}

async function read(): Promise<Cre> {
  const [reports, totalPaid, lastReportAt, all, head] = await Promise.all([
    publicClient.readContract({ address: KEEPER, abi: keeperAbi, functionName: "reports" }),
    publicClient.readContract({ address: KEEPER, abi: keeperAbi, functionName: "totalPaid" }),
    publicClient.readContract({ address: KEEPER, abi: keeperAbi, functionName: "lastReportAt" }),
    publicClient.readContract({ address: KEEPER, abi: keeperAbi, functionName: "allRates" }),
    publicClient.getBlockNumber(),
  ]);
  const [currencies, ratesE6, ats] = all;
  const rates = currencies.map((c, i) => ({ cur: cur3(c), rateE6: Number(ratesE6[i]), at: Number(ats[i]) })).filter((r) => r.rateE6 > 0);
  const lastAt = lastReportAt > 0n ? Number(lastReportAt) : null;

  let source: Cre["source"] = "rpc";
  let posted: Posted | null = null;
  let tabs: number | null = null;
  const url = envioUrl();
  if (url) {
    try {
      await readLogsEnvio(url, head);
      source = "envio-hyperrpc";
      posted = seen.posted;
      tabs = seen.tabs;
    } catch {
      // Fall through to the public RPC below.
    }
  }
  if (source === "rpc" && lastAt) {
    posted = cache?.value.lastAt === lastAt && cache.value.lastBlock ? { block: cache.value.lastBlock, tx: cache.value.lastTx!, at: lastAt } : null;
    posted ??= await findPostedRpc(lastAt, head).catch(() => null);
  }

  return {
    keeper: KEEPER,
    reports: Number(reports),
    lastBlock: posted?.block ?? null,
    lastTx: posted?.tx ?? null,
    lastAt,
    tabsSettledTotal: tabs,
    paidTotal: totalPaid.toString(),
    rates,
    fresh: lastAt != null && Date.now() / 1000 - lastAt < CRE_FRESH_SECONDS,
    source,
    updatedAt: Date.now(),
  };
}

let cache: { at: number; value: Cre } | null = null;
let pending: Promise<Cre> | null = null;

/** The keeper's state, at most a minute old; concurrent callers share one read. */
export async function getCre(): Promise<Cre> {
  if (cache && Date.now() - cache.at < TTL_MS) return { ...cache.value, fresh: cache.value.lastAt != null && Date.now() / 1000 - cache.value.lastAt < CRE_FRESH_SECONDS };
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
