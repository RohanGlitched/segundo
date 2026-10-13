import { getStats } from "@/lib/envio";
import { json } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Segundo's numbers straight from Monad, read through Envio HyperRPC: fees into the treasury, pay sent to
 * freelancers, tabs, people, and a row per day. Every money field is AUSD base units (6 dp) as a string.
 */
export async function GET() {
  try {
    return json(await getStats(), 200, { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" });
  } catch {
    return json({ error: "Monad didn't answer in time. Try again in a moment." }, 503, { "cache-control": "no-store" });
  }
}
