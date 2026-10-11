"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decodeEventLog, type Address, type Hex } from "viem";
import { tillAbi } from "./abi";
import { TILL, DOLLAR, publicClient, dollarAbi } from "./chain";
import { readProfiles, readTabs, type Profile, type TabView } from "./tabs";
import { requestTestDollars, type Landed } from "./relay";

/** Fired by the profile form after a save lands, so every profile on the page re-reads at once. */
export const PROFILE_SAVED = "till:profile";

/** One person's on-chain profile (name, city, currency), refreshed now and then and the moment it is saved. */
export function useProfile(address?: Address) {
  const [p, setP] = useState<Profile | undefined>();
  useEffect(() => {
    if (!address) return setP(undefined);
    let stop = false;
    const load = () => readProfiles([address]).then((m) => !stop && setP(m[address.toLowerCase()])).catch(() => {});
    load();
    const t = setInterval(load, 10000);
    window.addEventListener(PROFILE_SAVED, load);
    return () => {
      stop = true;
      clearInterval(t);
      window.removeEventListener(PROFILE_SAVED, load);
    };
  }, [address]);
  return p;
}

/** Reads tabs and the profiles of everyone on them, refreshing every few seconds and on demand. */
export function useTabs(ids: bigint[] | null, everyMs = 3000) {
  const [views, setViews] = useState<TabView[] | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [error, setError] = useState<string | null>(null);
  const key = ids == null ? "none" : `ids:${ids.map(String).join(",")}`;
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!ids || busy.current) return;
    busy.current = true;
    try {
      const v = await readTabs(ids);
      setViews(v);
      setError(null);
      const people = v.flatMap((x) => [x.tab.payer, x.tab.payee]);
      const p = await readProfiles(people);
      setProfiles((old) => ({ ...old, ...p }));
    } catch {
      setError("Monad's public RPC didn't answer. Retrying…");
    } finally {
      busy.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!ids) return;
    setViews(ids.length ? null : []);
    refresh();
    const t = setInterval(refresh, everyMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, everyMs]);

  return { views, profiles, error, refresh };
}

/** The ids of every tab a wallet is on, as client or freelancer. */
export function useMyTabIds(address?: Address) {
  const [ids, setIds] = useState<bigint[] | null>(null);
  const refresh = useCallback(async () => {
    if (!address) return setIds(null);
    try {
      const r = (await publicClient.readContract({ address: TILL, abi: tillAbi, functionName: "tabsOf", args: [address] })) as readonly bigint[];
      setIds((old) => (old && old.length === r.length ? old : [...r].reverse()));
    } catch {
      setIds((old) => old ?? []);
    }
  }, [address]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [refresh]);
  return { ids, refresh };
}

export function useDollarBalance(address?: Address) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const refresh = useCallback(async () => {
    if (!address) return setBalance(null);
    try {
      setBalance((await publicClient.readContract({ address: DOLLAR, abi: dollarAbi, functionName: "balanceOf", args: [address] })) as bigint);
    } catch {}
  }, [address]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [refresh]);
  return { balance, refresh };
}

/**
 * A wallet that arrives empty gets 25 test AUSD without asking (once per wallet per browser session),
 * so the first screen a judge sees already has money on it. Failures stay quiet; the manual button remains.
 */
export function useAutoDrip(address: Address | undefined, balance: bigint | null, onLanded?: () => void) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "failed">("idle");
  const [landed, setLanded] = useState<(Landed & { what: string }) | null>(null);
  useEffect(() => {
    if (!address || balance == null || balance > 0n || state !== "idle") return;
    const key = `till.drip.${address.toLowerCase()}`;
    try {
      if (sessionStorage.getItem(key)) return setState("done");
      sessionStorage.setItem(key, "1");
    } catch {}
    setState("sending");
    requestTestDollars(address)
      .then((r) => {
        setLanded({ ...r, what: "25 test AUSD arrived" });
        setState("done");
        onLanded?.();
      })
      .catch(() => setState("failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, balance, state]);
  useEffect(() => setState("idle"), [address]);
  return { sending: state === "sending", landed };
}

export type StubLine = {
  block: number;
  time: number;
  hash: Hex;
  kind: "opened" | "claimed" | "in" | "out" | "held" | "resumed" | "rate" | "topup" | "paid" | "closed";
  amount?: bigint;
  by?: Address;
};

/**
 * Walks a tab's history backwards through its Activity links: each step is one log query for one
 * exact block, which fits public RPC limits (they cap log queries at 100 blocks). A walk always
 * finishes; a newer head that arrives meanwhile is walked afterwards, from the new head down to
 * the old one, so a busy tab never restarts the whole read.
 */
export function useHistory(id: bigint | null, lastBlock: bigint | undefined, max = 14) {
  const [lines, setLines] = useState<StubLine[] | null>(null);
  const [more, setMore] = useState(false);
  const seen = useRef<{ id: string; head: bigint; lines: StubLine[] }>({ id: "", head: 0n, lines: [] });
  const walking = useRef(false);
  const queued = useRef<bigint | null>(null);
  const current = useRef("");
  const [again, setAgain] = useState(0);

  useEffect(() => () => void (current.current = ""), []);
  useEffect(() => {
    if (id == null || lastBlock == null) return;
    const sid = id.toString();
    current.current = sid;
    if (seen.current.id !== sid) {
      seen.current = { id: sid, head: 0n, lines: [] };
      setLines(null);
    }
    if (lastBlock === seen.current.head) return;
    if (walking.current) {
      queued.current = lastBlock;
      return;
    }
    walking.current = true;
    const cancelled = () => current.current !== sid;
    (async () => {
      const fresh: StubLine[] = [];
      let block = lastBlock;
      let steps = 0;
      const stopAt = seen.current.head;
      while (block > 0n && block !== stopAt && steps < max && !cancelled()) {
        const [logs, b] = await Promise.all([
          publicClient.getLogs({ address: TILL, fromBlock: block, toBlock: block }),
          publicClient.getBlock({ blockNumber: block }),
        ]);
        let prev = 0n;
        const inBlock: StubLine[] = [];
        for (const log of logs) {
          let ev;
          try {
            ev = decodeEventLog({ abi: tillAbi, data: log.data, topics: log.topics });
          } catch {
            continue;
          }
          const a = ev.args as Record<string, unknown>;
          if (a.id !== id) continue;
          const base = { block: Number(block), time: Number(b.timestamp), hash: log.transactionHash! };
          switch (ev.eventName) {
            case "Activity":
              prev = a.prevBlock as bigint;
              break;
            case "Opened":
              inBlock.push({ ...base, kind: "opened", amount: a.budget as bigint });
              break;
            case "Claimed":
              inBlock.push({ ...base, kind: "claimed" });
              break;
            case "ClockedIn":
              inBlock.push({ ...base, kind: "in" });
              break;
            case "ClockedOut":
              inBlock.push({ ...base, kind: "out", by: a.by as Address });
              break;
            case "Held":
              inBlock.push({ ...base, kind: a.held ? "held" : "resumed" });
              break;
            case "RateChanged":
              inBlock.push({ ...base, kind: "rate", amount: a.rate as bigint });
              break;
            case "ToppedUp":
              inBlock.push({ ...base, kind: "topup", amount: a.amount as bigint });
              break;
            case "Settled":
              inBlock.push({ ...base, kind: "paid", amount: a.amount as bigint });
              break;
            case "Closed":
              inBlock.push({ ...base, kind: "closed", amount: a.refunded as bigint });
              break;
          }
        }
        fresh.push(...inBlock.reverse());
        block = prev;
        steps++;
        // Show the stub as it is read, newest first, rather than after the whole walk.
        if (!cancelled() && (steps <= 3 || steps % 4 === 0)) setLines([...fresh, ...seen.current.lines]);
      }
      if (cancelled()) return;
      const merged = [...fresh, ...seen.current.lines].slice(0, 80);
      seen.current = { id: sid, head: lastBlock, lines: merged };
      setLines(merged);
      setMore(block > 0n && block !== stopAt);
    })()
      .catch(() => {
        if (!cancelled()) setLines((l) => l ?? []);
      })
      .finally(() => {
        walking.current = false;
        if (!cancelled() && queued.current != null && queued.current !== seen.current.head) {
          queued.current = null;
          setAgain((n) => n + 1);
        }
      });
  }, [id, lastBlock, max, again]);

  return { lines, more };
}
