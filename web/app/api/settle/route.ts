import { decodeEventLog, encodeFunctionData } from "viem";
import { tillAbi } from "@/lib/abi";
import { TILL, publicClient } from "@/lib/chain";
import { RESERVE, clientIp, json, keeperMon, limited, revertReason, sendAndWait, signer } from "@/lib/server";

export const runtime = "nodejs";


/**
 * Pays out whatever a tab has earned. Anyone may ask (money only ever goes to the freelancer);
 * the tab page calls it every few seconds while someone is watching, so the wallet balance moves live.
 * Every payout is a Monad transaction the relayer pays for, so the pace is capped per tab and overall.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { id?: string } | null;
  if (!b?.id || !/^\d{1,12}$/.test(b.id)) return json({ error: "Which tab?" }, 400);
  const id = BigInt(b.id);
  if (limited(`settle:${id}`, 1, 2_500)) return json({ skipped: true, reason: "Paid out moments ago." });
  if (limited(`settle-ip:${clientIp(req)}`, 30, 60_000) || limited("settle:all", 40, 60_000))
    return json({ skipped: true, reason: "The relayer is paying other tabs right now. Next payout in a moment." });
  const [view, head] = await Promise.all([
    publicClient.readContract({ address: TILL, abi: tillAbi, functionName: "getTab", args: [id] }) as Promise<{
      owed: bigint;
      tab: { payee: string; closed: boolean; lastBlock: bigint };
    }>,
    publicClient.getBlockNumber(),
  ]);
  if (view.tab.closed || /^0x0+$/.test(view.tab.payee)) return json({ skipped: true, reason: "Nothing to pay on this tab." });
  if (view.owed < 5_000n) return json({ skipped: true, reason: "Less than half a cent is owed." });
  // The tab's own last-activity block is a throttle every server instance agrees on: a few seconds.
  if (head - view.tab.lastBlock < 6n) return json({ skipped: true, reason: "Paid out moments ago." });
  try {
    const keeper = signer("keeper");
    const mon = await keeperMon();
    if (mon !== null && mon < RESERVE.settle)
      return json({ skipped: true, reason: "The relayer is low on test MON and is keeping it for clock-ins and closes. Earned pay is still owed and is paid at close." });
    const data = encodeFunctionData({ abi: tillAbi, functionName: "settle", args: [id] });
    const { logs, ...landed } = await sendAndWait(keeper, { to: TILL, data });
    // Report what actually moved, from the Settled event, rather than what was owed a second earlier.
    let amount = view.owed;
    for (const log of logs) {
      try {
        const ev = decodeEventLog({ abi: tillAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "Settled") amount = (ev.args as { amount: bigint }).amount;
      } catch {}
    }
    return json({ ...landed, amount });
  } catch (e) {
    return json({ error: revertReason(e) }, 502);
  }
}
