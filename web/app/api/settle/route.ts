import { decodeEventLog, encodeFunctionData } from "viem";
import { tillAbi } from "@/lib/abi";
import { TILL } from "@/lib/chain";
import { clientIp, json, limited, revertReason, rpc, sendAndWait, settleRelayer } from "@/lib/server";

export const runtime = "nodejs";

/** True when the request comes from the home page (its referrer path is "/"). */
function fromHome(req: Request): boolean {
  try {
    return new URL(req.headers.get("referer") ?? "").pathname === "/";
  } catch {
    return false;
  }
}


type View = { owed: bigint; tab: { payee: string; closed: boolean; held: boolean; since: bigint; rate: bigint; lastBlock: bigint } };

/** Blocks a tab must be quiet before another payout: a throttle every server instance agrees on (about 1.8 s). */
const QUIET_BLOCKS = 6n;
/** Monad's block time, a little long, for turning blocks still to wait into a sleep. */
const BLOCK_MS = 320;
/** The least worth a transaction: half a cent. */
const MIN_OWED = 5_000n;
/** The longest a request waits here for the throttle or the half cent, rather than turning the watcher away. */
const MAX_WAIT_MS = 3_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const read = (id: bigint) =>
  Promise.all([
    rpc.readContract({ address: TILL, abi: tillAbi, functionName: "getTab", args: [id] }) as Promise<View>,
    rpc.getBlockNumber({ cacheTime: 0 }),
  ]);

/**
 * Pays out whatever a tab has earned. Anyone may ask (money only ever goes to the freelancer);
 * the tab page calls it every few seconds while someone is watching, so the wallet balance moves live.
 * Every payout is a Monad transaction the relayer pays for, so the pace is capped per tab and overall.
 *
 * A request that comes a moment too early (the tab moved in the last few blocks, as it does on the clock-in itself,
 * or less than half a cent has built up yet) waits here for up to 3 s instead of being turned away, so the first
 * payout lands seconds after a clock-in rather than on the watcher's next round. `ms` in the answer is send to
 * receipt, measured here; `waitedMs` is any time spent waiting for the tab to be ready.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { id?: string } | null;
  if (!b?.id || !/^\d{1,12}$/.test(b.id)) return json({ error: "Which tab?" }, 400);
  const id = BigInt(b.id);
  if (limited(`settle:${id}`, 1, 2_500)) return json({ skipped: true, reason: "Paid out moments ago." });
  // The home page's hero asks for one payout per visit; reloads and a crowd of visitors share one payout per tab every 20 s.
  if (fromHome(req) && limited(`settle-home:${id}`, 1, 20_000)) return json({ skipped: true, reason: "Paid out moments ago." });
  if (limited(`settle-ip:${clientIp(req)}`, 30, 60_000) || limited("settle:all", 40, 60_000))
    return json({ skipped: true, reason: "The relayer is paying other tabs right now. Next payout in a moment." });
  try {
    const started = Date.now();
    let waited = 0;
    // The key is picked while the tab is read: both are needed, and neither depends on the other.
    const keyFor = settleRelayer(id);
    keyFor.catch(() => {}); // awaited below; a skip before then mustn't leave it unhandled
    let [view, head] = await read(id);
    for (let round = 0; ; round++) {
      if (view.tab.closed || /^0x0+$/.test(view.tab.payee)) return json({ skipped: true, reason: "Nothing to pay on this tab." });
      const running = view.tab.since > 0n && !view.tab.held && view.tab.rate > 0n;
      const quietFor = head - view.tab.lastBlock;
      const blocksToWait = quietFor < QUIET_BLOCKS ? Number(QUIET_BLOCKS - quietFor) * BLOCK_MS : 0;
      // Pay builds up at the tab's rate (AUSD units an hour) while the clock runs; a stopped clock adds nothing.
      const centsToWait = view.owed >= MIN_OWED ? 0 : running ? Number(((MIN_OWED - view.owed) * 3_600_000n) / view.tab.rate) + 50 : Infinity;
      const wait = Math.max(blocksToWait, centsToWait);
      if (wait === 0) break;
      if (round > 0 || Date.now() - started + wait > MAX_WAIT_MS)
        return json({ skipped: true, reason: view.owed < MIN_OWED ? "Less than half a cent is owed." : "Paid out moments ago." });
      await sleep(wait);
      waited += wait;
      [view, head] = await read(id);
    }
    const { relayer: keeper, low } = await keyFor;
    if (low)
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
    return json({ ...landed, amount, waitedMs: waited });
  } catch (e) {
    return json({ error: revertReason(e) }, 502);
  }
}
