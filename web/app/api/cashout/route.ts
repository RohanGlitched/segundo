import { clientIp, json, limited } from "@/lib/server";
import { AGORA_PAIR, SETTLE_CAP, settleCashOut, settlementConfigured } from "@/lib/settlement";

export const runtime = "nodejs";

/** Whether this deployment settles cash-outs through Agora, and against which pair; public facts only. */
export function GET() {
  return json({ settlement: settlementConfigured() ? "agora-instant-settlement" : "off", pair: AGORA_PAIR, capAusd: Number(SETTLE_CAP) / 1e6 });
}

/**
 * The partner leg of a cash-out: after the freelancer's transfer to the demo partner lands (/api/send), the partner
 * swaps that AUSD (up to 100) for Agora's test token CTK through Agora's Instant Settlement pair (lib/settlement.ts).
 * It reads the amount from the transfer on chain, so the caller only names the transfer.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { transfer?: string } | null;
  if (!b?.transfer || !/^0x[0-9a-fA-F]{64}$/.test(b.transfer)) return json({ error: "Which cash-out?" }, 400);
  if (limited(`cashout-ip:${clientIp(req)}`, 10, 60_000) || limited("cashout:all", 40, 60_000))
    return json({ error: "Agora settlement is busy. Your cash-out itself has landed." }, 429);
  const r = await settleCashOut(b.transfer as `0x${string}`);
  return json(r, "error" in r ? 502 : 200);
}
