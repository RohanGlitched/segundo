import "server-only";
import { publicClient } from "./chain";
import { BENCH_ADDRESSES, BENCH_TABS } from "./bench-addresses";

/**
 * Segundo's own Envio HyperIndex indexer (the code is in /indexer), read over its hosted GraphQL endpoint.
 *
 * The indexer folds every Till, AUSD-treasury and SegundoKeeper event into derived entities (Person, Tab, Payout,
 * Shift, DailyStat, Totals, CurrencyRate, KeeperRun…), so one query answers what the HyperRPC path in lib/envio.ts
 * has to rebuild from raw logs. The endpoint is public (no key). Every call has a 3-second timeout and answers are
 * kept for 20 seconds per instance; callers fall back to the HyperRPC ledger when a call fails or the indexer lags.
 */

export const HYPERINDEX_URL = "https://indexer.dev.hyperindex.xyz/bd7a257/v1/graphql";
export const INDEXER_SOURCE = "https://github.com/RohanGlitched/segundo/tree/main/indexer";
/** Past this the indexer is treated as lagging and HyperRPC's figures are preferred. */
export const MAX_LAG_SECONDS = 300;

const TIMEOUT_MS = 3_000;
const TTL_MS = 20_000;
/** The load benchmark's tabs are all closed, so its share of the figures never changes: read it every ten minutes. */
const BENCH_TTL_MS = 600_000;

const memo = new Map<string, { at: number; value: Promise<unknown> }>();

/** One GraphQL query: server-side, 3 s timeout, kept in memory for `ttl` ms (20 s by default). Never in the data cache, whose stale-while-revalidate copies would misreport the lag. */
async function gql<T>(query: string, variables: Record<string, unknown> = {}, ttl = TTL_MS): Promise<T> {
  const key = JSON.stringify([query, variables]);
  const held = memo.get(key);
  if (held && Date.now() - held.at < ttl) return held.value as Promise<T>;
  const value = (async () => {
    let res: Response;
    try {
      res = await fetch(HYPERINDEX_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      throw new Error(e instanceof Error && e.name === "TimeoutError" ? "HyperIndex timed out" : "HyperIndex unreachable");
    }
    if (!res.ok) throw new Error(`HyperIndex HTTP ${res.status}`);
    const body = (await res.json()) as { data?: T; errors?: { message?: string }[] };
    if (body.errors?.length || !body.data) throw new Error(`HyperIndex: ${body.errors?.[0]?.message ?? "no data"}`);
    return body.data;
  })();
  memo.set(key, { at: Date.now(), value });
  value.catch(() => memo.delete(key));
  if (memo.size > 200) for (const [k, v] of memo) if (Date.now() - v.at > BENCH_TTL_MS) memo.delete(k);
  return value;
}

export type IndexStatus = {
  /** Last block the indexer has processed. */
  block: number;
  /** Monad's head from the public RPC, when it answered. */
  head: number | null;
  lagBlocks: number | null;
  /** Seconds between now and the indexed block's own timestamp. */
  lagSeconds: number | null;
  events: number;
};

type ChainMeta = { latest_processed_block: number; num_events_processed: number };
const META = `chain_metadata { latest_processed_block num_events_processed }`;

let blockTimes = new Map<number, number>();

/** How far behind Monad the indexer is: the indexed block's age, from the chain itself (2 s at most). */
async function status(meta: ChainMeta): Promise<IndexStatus> {
  const block = Number(meta.latest_processed_block);
  const read = async () => {
    const [head, at] = await Promise.all([
      publicClient.getBlockNumber({ cacheTime: 5_000 }),
      blockTimes.get(block) ?? publicClient.getBlock({ blockNumber: BigInt(block) }).then((b) => Number(b.timestamp)),
    ]);
    if (blockTimes.size > 50) blockTimes = new Map();
    blockTimes.set(block, at);
    return { head: Number(head), at };
  };
  const chain = await Promise.race([read().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 2_000))]);
  return {
    block,
    head: chain?.head ?? null,
    lagBlocks: chain ? Math.max(0, chain.head - block) : null,
    lagSeconds: chain ? Math.max(0, Math.round(Date.now() / 1000 - chain.at)) : null,
    events: Number(meta.num_events_processed),
  };
}

export const lagging = (s: IndexStatus) => s.lagSeconds != null && s.lagSeconds > MAX_LAG_SECONDS;

// ---------------------------------------------------------------- one person's all-time record

export type IndexedPerson = {
  status: IndexStatus;
  /** Null when the indexer has never seen this address. Money is AUSD base units as strings. */
  person: {
    name: string | null;
    place: string | null;
    currency: string | null;
    earned: string;
    payoutsReceived: number;
    clients: number;
    tabsAsFreelancer: number;
    shifts: number;
    secondsWorked: string;
    firstSeen: number;
  } | null;
  firstPayout: { timestamp: number; block: number; tx: string } | null;
  lastPayout: { timestamp: number; block: number; tx: string } | null;
  /** Distinct UTC days with at least one payout. */
  daysPaid: number;
  /** The newest payouts (block and amount), so a page can line the indexed totals up with another read at any block. */
  recent: { block: number; amount: string }[];
  /** The CRE-posted rate for the person's profile currency, if one is on chain. */
  rate: { code: string; rateE6: string; at: number } | null;
};

const RECENT = 200;

const PERSON = `
query Person($id: String!) {
  ${META}
  Person_by_pk(id: $id) { name place currency earned payoutsReceived clients tabsAsFreelancer shifts secondsWorked firstSeen }
  first: Payout(where: { payee_id: { _eq: $id } }, order_by: { timestamp: asc }, limit: 1) { timestamp block tx }
  last: Payout(where: { payee_id: { _eq: $id } }, order_by: { timestamp: desc }, limit: 1) { timestamp block tx }
  days: Payout(where: { payee_id: { _eq: $id } }, distinct_on: day, order_by: { day: asc }) { day }
  recent: Payout(where: { payee_id: { _eq: $id } }, order_by: [{ block: desc }], limit: ${RECENT}) { block amount }
  CurrencyRate { id rateE6 at }
}`;

type PersonReply = {
  chain_metadata: ChainMeta[];
  Person_by_pk: (Omit<NonNullable<IndexedPerson["person"]>, "earned" | "secondsWorked"> & { earned: string | number; secondsWorked: string | number }) | null;
  first: { timestamp: number; block: number; tx: string }[];
  last: { timestamp: number; block: number; tx: string }[];
  days: { day: string }[];
  recent: { block: number; amount: string | number }[];
  CurrencyRate: { id: string; rateE6: string | number; at: number }[];
};

export async function indexedPerson(address: string): Promise<IndexedPerson> {
  const d = await gql<PersonReply>(PERSON, { id: address.toLowerCase() });
  if (!d.chain_metadata?.[0]) throw new Error("HyperIndex: no chain metadata");
  const p = d.Person_by_pk;
  const rate = p?.currency ? d.CurrencyRate.find((r) => r.id === p.currency) : undefined;
  return {
    status: await status(d.chain_metadata[0]),
    person: p ? { ...p, earned: String(p.earned), secondsWorked: String(p.secondsWorked) } : null,
    firstPayout: d.first[0] ?? null,
    lastPayout: d.last[0] ?? null,
    daysPaid: d.days.length,
    recent: d.recent.map((r) => ({ block: Number(r.block), amount: String(r.amount) })),
    rate: rate ? { code: rate.id, rateE6: String(rate.rateE6), at: rate.at } : null,
  };
}

// ---------------------------------------------------------------- the whole network, day by day

export type NetworkDay = { day: string; paid: string; payouts: number; tabs: number; seconds: number | null };
export type IndexedNetwork = {
  status: IndexStatus;
  /** Since deployment, the load benchmark left out (as on every page of the site). */
  totals: { paid: string; payouts: number; tabs: number; seconds: number | null; keeperRuns: number | null; rateReports: number | null };
  /** The last `days` UTC days, oldest first, quiet days included. */
  daily: NetworkDay[];
  /** What was taken out: the Oct 13 load benchmark's tabs and payouts. */
  bench: { tabs: number; payouts: number };
};

const BENCH_LOWER = BENCH_ADDRESSES.map((a) => a.toLowerCase());
/** The same rule as lib/envio.ts: a benchmark tab is in BENCH_TABS or has a benchmark wallet on either side. */
const BENCH_TAB = `{ _or: [{ number: { _gte: "${BENCH_TABS.from}", _lte: "${BENCH_TABS.to}" } }, { payer_id: { _in: $bench } }, { payee_id: { _in: $bench } }] }`;

const NETWORK = `
query Network($days: Int!) {
  ${META}
  Totals_by_pk(id: "totals") { paid payouts tabsOpened secondsWorked keeperRuns rateReports }
  DailyStat(order_by: { date: desc }, limit: $days) { id payouts paid tabsOpened secondsWorked }
}`;

const BENCH = `
query Bench($bench: [String!]!) {
  benchTabs: Tab(where: ${BENCH_TAB}, limit: 1000) { openedAt }
  benchPays: Payout(where: { tab: ${BENCH_TAB} }, limit: 5000) { day amount }
  benchShifts: Shift(where: { tab: ${BENCH_TAB}, seconds: { _is_null: false } }, limit: 5000) { end seconds }
}`;

type NetworkReply = {
  chain_metadata: ChainMeta[];
  Totals_by_pk: { paid: string | number; payouts: number; tabsOpened: number; secondsWorked: string | number; keeperRuns: number; rateReports: number } | null;
  DailyStat: { id: string; payouts: number; paid: string | number; tabsOpened: number; secondsWorked: string | number }[];
};
type BenchReply = {
  benchTabs: { openedAt: number }[];
  benchPays: { day: string; amount: string | number }[];
  benchShifts: { end: number; seconds: string | number }[];
};

const dayOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

export async function indexedNetwork(days = 14): Promise<IndexedNetwork> {
  const [n, b] = await Promise.all([gql<NetworkReply>(NETWORK, { days }), gql<BenchReply>(BENCH, { bench: BENCH_LOWER }, BENCH_TTL_MS)]);
  const d = { ...n, ...b };
  if (!d.chain_metadata?.[0] || !d.Totals_by_pk) throw new Error("HyperIndex: no totals yet");
  // The benchmark's share of each day, taken out so these figures match /api/stats.
  const less = new Map<string, { paid: bigint; payouts: number; tabs: number; seconds: number }>();
  const row = (day: string) => {
    let r = less.get(day);
    if (!r) less.set(day, (r = { paid: 0n, payouts: 0, tabs: 0, seconds: 0 }));
    return r;
  };
  for (const p of d.benchPays) {
    const r = row(p.day);
    r.paid += BigInt(p.amount);
    r.payouts++;
  }
  for (const t of d.benchTabs) row(dayOf(t.openedAt)).tabs++;
  for (const s of d.benchShifts) row(dayOf(s.end)).seconds += Number(s.seconds);
  const benchPaid = d.benchPays.reduce((s, p) => s + BigInt(p.amount), 0n);
  const benchSeconds = d.benchShifts.reduce((s, x) => s + Number(x.seconds), 0);

  const byDay = new Map(d.DailyStat.map((s) => [s.id, s]));
  const now = Math.floor(Date.now() / 1000);
  const daily: NetworkDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayOf(now - i * 86_400);
    const s = byDay.get(day);
    const b = less.get(day);
    daily.push({
      day,
      paid: ((s ? BigInt(s.paid) : 0n) - (b?.paid ?? 0n)).toString(),
      payouts: (s?.payouts ?? 0) - (b?.payouts ?? 0),
      tabs: (s?.tabsOpened ?? 0) - (b?.tabs ?? 0),
      seconds: Number(s?.secondsWorked ?? 0) - (b?.seconds ?? 0),
    });
  }
  const t = d.Totals_by_pk;
  return {
    status: await status(d.chain_metadata[0]),
    totals: {
      paid: (BigInt(t.paid) - benchPaid).toString(),
      payouts: t.payouts - d.benchPays.length,
      tabs: t.tabsOpened - d.benchTabs.length,
      seconds: Number(t.secondsWorked) - benchSeconds,
      keeperRuns: t.keeperRuns,
      rateReports: t.rateReports,
    },
    daily,
    bench: { tabs: d.benchTabs.length, payouts: d.benchPays.length },
  };
}
