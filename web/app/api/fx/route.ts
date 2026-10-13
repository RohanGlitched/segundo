import { CRE_CURRENCIES, getCre, type Cre } from "@/lib/cre";
import type { RateSources } from "@/lib/money";
import { json } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Exchange rates per US dollar, shown to people and never used to move money.
 * For the currencies Segundo's Chainlink CRE workflow posts (PHP, NGN, INR, BRL, KES, EUR), the rate is the one the
 * DON agreed on and wrote to SegundoKeeper on Monad, as long as the newest report is under 6 hours old; `sources`
 * names the block. Every other currency, or all of them when the keeper is quiet, uses the daily reference rate from
 * open.er-api.com (no key).
 */
export async function GET() {
  const [reference, cre] = await Promise.all([
    fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => (d.result === "success" ? (d as { rates: Record<string, number>; time_last_update_utc: string }) : null))
      .catch(() => null),
    getCre().catch(() => null as Cre | null),
  ]);

  const rates: Record<string, number> = reference ? { ...reference.rates } : {};
  const sources: RateSources = {};
  const onChain = cre?.fresh ? cre : null;
  for (const code of CRE_CURRENCIES) {
    const r = onChain?.rates.find((x) => x.cur === code);
    if (r && onChain) {
      rates[code] = r.rateE6 / 1e6;
      sources[code] = { source: "chainlink-cre", block: onChain.lastBlock, at: r.at, tx: onChain.lastTx };
    } else if (rates[code] != null) sources[code] = { source: "reference" };
  }
  if (!Object.keys(rates).length) return json({ rates: null, updated: null, sources: {}, cre: null }, 200, { "cache-control": "public, s-maxage=60" });
  rates.USD = 1;

  return json(
    {
      rates,
      updated: reference?.time_last_update_utc ?? (onChain?.lastAt ? new Date(onChain.lastAt * 1000).toUTCString() : null),
      sources,
      cre: onChain ? { keeper: onChain.keeper, block: onChain.lastBlock, at: onChain.lastAt, tx: onChain.lastTx } : null,
    },
    200,
    // Short enough that a new report shows within minutes of landing (they arrive about every half hour).
    { "cache-control": reference ? "public, s-maxage=300, stale-while-revalidate=3600" : "public, s-maxage=60" },
  );
}
