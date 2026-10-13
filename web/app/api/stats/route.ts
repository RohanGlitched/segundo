import { getStats } from "@/lib/envio";
import { json } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Segundo's numbers straight from Monad, read through Envio HyperRPC: fees into the treasury, pay sent to
 * freelancers, tabs, people, and a row per day. Every money field is AUSD base units (6 dp) as a string.
 * When HyperRPC fails the reply is the last full snapshot (with `asOf`) or a short public-RPC window (`source: "rpc"`).
 */
export async function GET() {
  try {
    const stats = await getStats();
    // A fallback read (the public RPC's short window, or the last full snapshot) must never sit in the CDN: the next
    // request should try HyperRPC again.
    const full = stats.source !== "rpc" && !stats.asOf;
    return json(stats, 200, { "cache-control": full ? "public, s-maxage=60, stale-while-revalidate=300" : "no-store" });
  } catch {
    return json({ error: "Monad didn't answer in time. Try again in a moment." }, 503, { "cache-control": "no-store" });
  }
}
