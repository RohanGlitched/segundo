import { getAddress, isAddress } from "viem";
import { getStats } from "@/lib/envio";
import { HYPERINDEX_URL, INDEXER_SOURCE, indexedNetwork, indexedPerson, lagging, type IndexedNetwork } from "@/lib/hyperindex";
import { json } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The HyperRPC fallback's share of the request (its first full read can take longer; then it is skipped). */
const FALLBACK_MS = 8_000;

const late = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`over ${ms} ms`)), ms))]);

const why = (e: unknown) => (e instanceof Error ? e.message : "HyperIndex failed");
const minutes = (s: number) => (s < 120 ? `${s} s` : `${Math.round(s / 60)} min`);

/**
 * Segundo's HyperIndex indexer, read for the /proof pages.
 *
 * GET /api/envio?address=0x…  one person's all-time record (Person, Payout, CurrencyRate). On failure: 503, and the
 *                             statement page computes the same record from the HyperRPC history it already holds.
 * GET /api/envio              the network by day (DailyStat, Totals, minus the load benchmark). When HyperIndex fails
 *                             or is more than five minutes behind, the same rows come from the HyperRPC ledger.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const about = { endpoint: HYPERINDEX_URL, source: INDEXER_SOURCE };
  const address = q.get("address");

  if (address != null) {
    if (!isAddress(address, { strict: false })) return json({ error: "That isn't a Monad address." }, 400);
    try {
      const p = await indexedPerson(getAddress(address));
      return json({ from: "envio-hyperindex", lagging: lagging(p.status), ...about, ...p }, 200, {
        "cache-control": "public, s-maxage=20, stale-while-revalidate=60",
      });
    } catch (e) {
      return json({ from: null, reason: why(e), ...about }, 503, { "cache-control": "no-store" });
    }
  }

  let indexed: IndexedNetwork | null = null;
  let reason: string | null = null;
  try {
    indexed = await indexedNetwork(14);
    if (!lagging(indexed.status)) {
      return json({ from: "envio-hyperindex", lagging: false, ...about, ...indexed }, 200, { "cache-control": "public, s-maxage=20, stale-while-revalidate=60" });
    }
    reason = `HyperIndex is ${minutes(indexed.status.lagSeconds ?? 0)} behind Monad`;
  } catch (e) {
    reason = why(e);
  }

  // HyperRPC: the same figures rebuilt from raw logs (lib/envio.ts), already without the load benchmark.
  try {
    const s = await late(getStats(), FALLBACK_MS);
    // The public RPC's few-minute window is not a ledger; a lagging index beats it.
    if (s.source === "rpc") throw new Error(s.fallback ?? "HyperRPC unavailable");
    const daily = s.daily.slice(-14).map((d) => ({ day: d.day, paid: d.paid, payouts: d.payouts, tabs: d.tabs, seconds: null }));
    return json(
      {
        from: "envio-hyperrpc",
        reason,
        asOf: s.asOf ?? s.updatedAt,
        ...about,
        totals: { paid: s.paid.total, payouts: s.paid.payouts, tabs: s.paid.tabs, seconds: null, keeperRuns: null, rateReports: null },
        daily,
        bench: s.bench,
        status: indexed?.status ?? null,
      },
      200,
      { "cache-control": "no-store" },
    );
  } catch (e) {
    if (indexed) return json({ from: "envio-hyperindex", lagging: true, reason, ...about, ...indexed }, 200, { "cache-control": "no-store" });
    return json({ from: null, reason: `${reason}; HyperRPC: ${why(e)}`, ...about }, 503, { "cache-control": "no-store" });
  }
}
