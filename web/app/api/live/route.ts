import { decodeEventLog } from "viem";
import { tillAbi } from "@/lib/abi";
import { TILL, publicClient } from "@/lib/chain";
import { json } from "@/lib/server";
import { earnedAt, readProfiles, readTabs } from "@/lib/tabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cache: { at: number; body: unknown } | null = null;

/**
 * Network-wide numbers for the landing page, read straight from contract state (no indexer):
 * how many tabs exist and run right now, what has been earned, every open tab, one running tab to
 * feature, and the latest payouts (found by following each tab's Activity link to its last block).
 */
export async function GET() {
  if (cache && Date.now() - cache.at < 4000) return json(cache.body, 200, { "cache-control": "no-store" });
  try {
    const count = (await publicClient.readContract({ address: TILL, abi: tillAbi, functionName: "tabCount" })) as bigint;
    const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));
    const [tabs, block] = await Promise.all([readTabs(ids), publicClient.getBlock()]);
    const now = Number(block.timestamp);
    let paid = 0n;
    let earned = 0n;
    const running = tabs.filter((v) => !v.tab.closed && v.tab.since > 0n && earnedAt(v.tab, now) < v.tab.budget);
    for (const v of tabs) {
      paid += v.tab.paid;
      earned += earnedAt(v.tab, now);
    }
    const open = tabs.filter((v) => !v.tab.closed);
    // Feature the running tab that has been going longest, so the hero has a story behind it. Between
    // shifts, show the tab that changed most recently and has a freelancer on it and budget left
    // (never an unclaimed invite, and a spent tab only when nothing else is open).
    const claimed = open.filter((v) => !/^0x0+$/.test(v.tab.payee));
    const byRecent = (a: (typeof open)[number], b: (typeof open)[number]) => Number(b.tab.lastBlock - a.tab.lastBlock);
    const featured =
      [...running].sort((a, b) => Number(a.tab.since - b.tab.since))[0] ??
      claimed.filter((v) => earnedAt(v.tab, now) < v.tab.budget).sort(byRecent)[0] ??
      claimed.sort(byRecent)[0] ??
      open.at(-1) ??
      null;

    // Latest payouts: the most recently active tabs, one exact-block log query each.
    const recentTabs = [...tabs].sort((a, b) => Number(b.tab.lastBlock - a.tab.lastBlock)).slice(0, 6);
    const found = await Promise.all(
      recentTabs.map(async (v) => {
        const out: { id: string; payee: string; amount: string; block: number; time: number; hash: string }[] = [];
        let b = v.tab.lastBlock;
        for (let step = 0; step < 4 && b > 0n && out.length === 0; step++) {
          const at = b;
          const logs = await publicClient.getLogs({ address: TILL, fromBlock: at, toBlock: at }).catch(() => []);
          let prev = 0n;
          for (const log of logs) {
            try {
              const ev = decodeEventLog({ abi: tillAbi, data: log.data, topics: log.topics });
              const a = ev.args as Record<string, unknown>;
              if (a.id !== v.id) continue;
              if (ev.eventName === "Activity") prev = a.prevBlock as bigint;
              if (ev.eventName === "Settled")
                out.push({ id: String(v.id), payee: String(a.payee), amount: String(a.amount), block: Number(at), time: 0, hash: log.transactionHash! });
            } catch {}
          }
          b = prev;
        }
        await Promise.all(
          out.map(async (o) => {
            const blk = await publicClient.getBlock({ blockNumber: BigInt(o.block) }).catch(() => null);
            o.time = Number(blk?.timestamp ?? 0);
          }),
        );
        return out;
      }),
    );
    const recent = found.flat().sort((a, b) => b.block - a.block).slice(0, 6);

    const profiles = await readProfiles(open.flatMap((v) => [v.tab.payer, v.tab.payee]).concat(recent.map((r) => r.payee as `0x${string}`)));
    const body = {
      tabs: tabs.length,
      running: running.length,
      paid,
      earned,
      block: Number(block.number),
      blockTime: now,
      featured,
      open,
      recent,
      profiles,
    };
    cache = { at: Date.now(), body };
    return json(body, 200, { "cache-control": "no-store" });
  } catch {
    return json({ tabs: null }, 200, { "cache-control": "no-store" });
  }
}
