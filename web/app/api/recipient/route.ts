import { privyServerReady, recipientWallet } from "@/lib/privy-server";
import { cleanEmail } from "@/lib/recipient";
import { clientIp, json, limited } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { email } → { address, existing }: the wallet to send AUSD to for that email, made through Privy if its owner
 * doesn't have one yet. The answer has the same shape whether or not the person is new, and lookups are rate limited
 * per caller, so the route can't be used to sweep a list of addresses.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof b?.email === "string" ? cleanEmail(b.email) : null;
  if (!email) return json({ error: "Enter a full email address, like name@example.com." }, 400);
  if (!privyServerReady()) return json({ error: "Sending to an email address isn't switched on here. Send to a wallet address instead." }, 503);
  const ip = clientIp(req);
  if (limited(`recipient-ip:${ip}`, 10, 60_000) || limited(`recipient-ip-h:${ip}`, 60, 3_600_000) || limited("recipient:all", 600, 3_600_000))
    return json({ error: "Too many lookups. Try again in a few minutes." }, 429);
  try {
    return json(await recipientWallet(email), 200, { "cache-control": "no-store" });
  } catch (e) {
    console.error("recipient", e instanceof Error ? e.message : e);
    return json({ error: "Couldn't set up a wallet for that email right now. Try again in a moment, or send to a wallet address." }, 502);
  }
}
