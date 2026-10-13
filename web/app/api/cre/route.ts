import { getCre } from "@/lib/cre";
import { json } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Segundo's Chainlink CRE keeper as Monad sees it: reports landed, the block and report time of the newest trusted rates,
 * tabs settled and AUSD paid through it, and the rate per currency (units per 1 USD, times 10^6).
 */
export async function GET() {
  try {
    const cre = await getCre();
    return json(cre, 200, { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" });
  } catch {
    return json({ error: "Monad didn't answer in time. Try again in a moment." }, 503, { "cache-control": "no-store" });
  }
}
