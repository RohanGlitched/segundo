import { json } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Daily reference rates (open.er-api.com, no key), cached at the edge for an hour. Shown to people, never used to move money. */
export async function GET() {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
    const data = await res.json();
    if (data.result !== "success") throw new Error("bad rates");
    return json({ rates: data.rates, updated: data.time_last_update_utc }, 200, {
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=3600",
    });
  } catch {
    return json({ rates: null, updated: null }, 200, { "cache-control": "public, s-maxage=60" });
  }
}
