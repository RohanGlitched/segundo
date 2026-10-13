import { getAddress, isAddress } from "viem";
import { getHistory } from "@/lib/envio";
import { json } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One address's pay history from Monad, read through Envio HyperRPC: every tab it opened or was paid on, each
 * payout, refund, top-up, clock-in and clock-out, and the Segundo fees it paid. `?limit=` keeps only the newest lines
 * (totals always cover everything).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("address") ?? "";
  if (!isAddress(raw, { strict: false })) return json({ error: "Pass ?address= with a Monad address (0x…)." }, 400);
  const limit = Number(url.searchParams.get("limit"));
  try {
    const h = await getHistory(getAddress(raw));
    if (Number.isInteger(limit) && limit > 0) h.items = h.items.slice(0, limit);
    return json(h, 200, { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" });
  } catch {
    return json({ error: "Monad didn't answer in time. Try again in a moment." }, 503, { "cache-control": "no-store" });
  }
}
