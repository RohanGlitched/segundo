import { decodeEventLog, getAddress, isAddress, type Address, type Log } from "viem";
import { tillAbi } from "@/lib/abi";
import { TILL, publicClient } from "@/lib/chain";
import { getHistory, type History, type HistoryItem } from "@/lib/envio";
import { json } from "@/lib/server";
import { readTabs } from "@/lib/tabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The public RPC caps a log query at 100 blocks. */
const PAGE = 100n;
/** The most blocks the fresh read covers (about ten minutes of Monad); a longer gap waits for the ledger to catch up. */
const MAX_GAP = 1_500n;
/** Only the newest tabs are checked for activity newer than the ledger. */
const RECENT_TABS = 80;
/** The fresh read's share of the request; past it the ledger's answer goes out as it is. */
const FRESH_MS = 6_000;

const lower = (a: string) => a.toLowerCase();
const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * The ledger behind getHistory is read through HyperRPC and kept for up to a minute, so a payout that landed a few
 * seconds ago isn't in it yet. When one of this address's tabs has changed after the ledger's last block, the
 * blocks in between are read straight from Monad and their lines added, and `head` moves up to match. Fee transfers
 * in that gap are left to the next ledger read (they are AUSD transfers, not tab events).
 */
async function freshen(h: History, address: Address): Promise<boolean> {
  const me = lower(address);
  const ids = (await publicClient.readContract({ address: TILL, abi: tillAbi, functionName: "tabsOf", args: [address] })) as readonly bigint[];
  if (!ids.length) return false;
  const views = await readTabs(ids.slice(-RECENT_TABS));
  const from = BigInt(h.head) + 1n;
  const busy = views.filter((v) => v.tab.lastBlock >= from);
  if (!busy.length) return false;
  const to = busy.reduce((m, v) => (v.tab.lastBlock > m ? v.tab.lastBlock : m), 0n);
  if (to - from > MAX_GAP) return false;

  const pages: Promise<Log[]>[] = [];
  for (let a = from; a <= to; a += PAGE) {
    const b = a + PAGE - 1n < to ? a + PAGE - 1n : to;
    pages.push(publicClient.getLogs({ address: TILL, fromBlock: a, toBlock: b }));
  }
  const logs = (await Promise.all(pages)).flat();
  const byId = new Map(busy.map((v) => [v.id.toString(), v.tab]));
  const decoded = logs
    .map((log) => {
      try {
        const ev = decodeEventLog({ abi: tillAbi, data: log.data, topics: log.topics });
        const id = String((ev.args as { id?: bigint }).id ?? "");
        return byId.has(id) ? { log, ev, id } : null;
      } catch {
        return null;
      }
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  if (!decoded.length) return false;

  const blocks = [...new Set(decoded.map((d) => d.log.blockNumber!))];
  const times = new Map(
    await Promise.all(blocks.map(async (n) => [n, Number((await publicClient.getBlock({ blockNumber: n })).timestamp)] as const)),
  );

  const added: HistoryItem[] = [];
  let earned = 0n;
  let paidOut = 0n;
  for (const { log, ev, id } of decoded) {
    const t = byId.get(id)!;
    const amPayer = lower(t.payer) === me;
    const a = ev.args as Record<string, unknown>;
    const line = {
      tab: id,
      block: Number(log.blockNumber),
      time: times.get(log.blockNumber!) ?? 0,
      hash: log.transactionHash!,
      counterparty: amPayer ? (t.payee === ZERO ? null : t.payee) : t.payer,
      role: amPayer ? ("client" as const) : ("freelancer" as const),
    };
    switch (ev.eventName) {
      case "Opened":
        added.push({ ...line, kind: "opened", amount: String(a.budget) });
        break;
      case "ToppedUp":
        added.push({ ...line, kind: "topup", amount: String(a.amount) });
        break;
      case "ClockedIn":
        added.push({ ...line, kind: "clockIn", amount: null });
        break;
      case "ClockedOut":
        added.push({ ...line, kind: "clockOut", amount: null });
        break;
      case "Settled": {
        const amount = a.amount as bigint;
        if (lower(a.payee as string) === me) earned += amount;
        if (amPayer) paidOut += amount;
        added.push({ ...line, kind: "paid", amount: amount.toString(), counterparty: amPayer ? (a.payee as Address) : t.payer });
        break;
      }
      case "Closed":
        added.push({ ...line, kind: "closed", amount: String(a.paid) });
        if (amPayer && (a.refunded as bigint) > 0n) added.push({ ...line, kind: "refund", amount: String(a.refunded) });
        break;
    }
  }
  // Newest first, and within a block the reverse of the order the contract emitted them, as getHistory sorts.
  added.reverse();
  h.items = [...added, ...h.items];
  // The fallback's totals come from contract state read just now, so they already include these payouts.
  if (h.source !== "rpc") {
    h.totals.earned = (BigInt(h.totals.earned) + earned).toString();
    h.totals.paidOut = (BigInt(h.totals.paidOut) + paidOut).toString();
  }
  h.head = Number(to);
  return true;
}

/**
 * One address's pay history from Monad, read through Envio HyperRPC: every tab it opened or was paid on, each
 * payout, refund, top-up, clock-in and clock-out, and the Segundo fees it paid. `?limit=` keeps only the newest lines
 * (totals always cover everything). `head` is the block the history is complete to, for an "as of block N" line.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("address") ?? "";
  if (!isAddress(raw, { strict: false })) return json({ error: "Pass ?address= with a Monad address (0x…)." }, 400);
  const limit = Number(url.searchParams.get("limit"));
  try {
    const address = getAddress(raw);
    const h = await getHistory(address);
    // Copy before adding fresh lines: the ledger behind getHistory is shared by every request on this instance.
    const out: History = { ...h, items: [...h.items], totals: { ...h.totals } };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fresh = await Promise.race([
      freshen(out, address).catch(() => false),
      new Promise<false>((r) => (timer = setTimeout(() => r(false), FRESH_MS))),
    ]).finally(() => clearTimeout(timer));
    if (Number.isInteger(limit) && limit > 0) out.items = out.items.slice(0, limit);
    // An address with lines newer than the ledger is mid-activity: don't let a cache hold that answer.
    return json(out, 200, { "cache-control": fresh ? "no-store" : "public, s-maxage=10, stale-while-revalidate=30" });
  } catch {
    return json({ error: "Monad didn't answer in time. Try again in a moment." }, 503, { "cache-control": "no-store" });
  }
}
