"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decodeEventLog, type Address, type Hex } from "viem";
import { tillAbi } from "./abi";
import { TILL, DOLLAR, publicClient, dollarAbi } from "./chain";
import { readProfiles, readTabs, type Profile, type TabView } from "./tabs";
import { plainError, requestTestDollars, type Landed } from "./relay";

/** Fired by the profile form after a save lands, so every profile on the page re-reads at once. */
export const PROFILE_SAVED = "till:profile";

/**
 * Monad's public RPC answers "429 Too Many Requests" when a browser asks too often. Every poll on the page shares
 * one cool-down: after a 429 the polls skip their turns for 2 s, then 4, 8, up to 30 s, and the first answer that
 * comes back resets it. Polls also rest while the page is in the background.
 */
const cool = { until: 0, step: 0 };
const isRateLimit = (e: unknown): boolean => {
  const x = e as { status?: number; cause?: unknown; message?: string } | null;
  if (!x) return false;
  if (x.status === 429 || /429|too many requests|rate limit/i.test(x.message ?? "")) return true;
  return x.cause != null && x.cause !== e && isRateLimit(x.cause);
};
/** Call with the error of a failed read; returns true when it was a rate limit and the cool-down grew. */
export function noteRpcError(e: unknown): boolean {
  if (!isRateLimit(e)) return false;
  cool.step = Math.min(cool.step + 1, 5);
  cool.until = Date.now() + Math.min(30_000, 1000 * 2 ** cool.step);
  return true;
}
export function noteRpcOk() {
  cool.step = 0;
}
/** Whether a poll should skip this turn: the RPC asked us to slow down, or nobody is looking at the page. */
export const rpcResting = () => Date.now() < cool.until || (typeof document !== "undefined" && document.visibilityState === "hidden");

/** What useProfile returns for an account that has never saved a profile, as opposed to undefined: not read yet. */
export const NO_PROFILE: Profile = { name: "", place: "", currency: "" };

/** One person's on-chain profile (name, city, currency), refreshed now and then and the moment it is saved. */
export function useProfile(address?: Address) {
  const [p, setP] = useState<Profile | undefined>();
  useEffect(() => {
    if (!address) return setP(undefined);
    let stop = false;
    const load = () =>
      readProfiles([address])
        .then((m) => {
          noteRpcOk();
          if (!stop) setP(m[address.toLowerCase()] ?? NO_PROFILE);
        })
        .catch(noteRpcError);
    load();
    const t = setInterval(() => !rpcResting() && load(), 10000);
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
      // Names arrive with the tabs, not a moment after: a note that reads "0x9298…" and then "Tunde Bakare" (and
      // switches currency) reflows the page. A failed name read still shows the tabs.
      const people = v.flatMap((x) => [x.tab.payer, x.tab.payee]);
      const p = await readProfiles(people).catch((e) => {
        noteRpcError(e);
        return {} as Record<string, Profile>;
      });
      setProfiles((old) => ({ ...old, ...p }));
      setViews(v);
      setError(null);
      noteRpcOk();
    } catch (e) {
      setError(noteRpcError(e) ? "Monad's public RPC asked us to slow down. Retrying in a moment…" : "Monad's public RPC didn't answer. Retrying…");
    } finally {
      busy.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!ids) return;
    setViews(ids.length ? null : []);
    refresh();
    const t = setInterval(() => !rpcResting() && refresh(), everyMs);
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
      noteRpcOk();
    } catch (e) {
      // A rate limit isn't "no tabs": keep waiting rather than show an empty list.
      if (!noteRpcError(e)) setIds((old) => old ?? []);
    }
  }, [address]);
  useEffect(() => {
    refresh();
    const t = setInterval(() => !rpcResting() && refresh(), 6000);
    return () => clearInterval(t);
  }, [refresh]);
  return { ids, refresh };
}

/** The faucet's drip, as app/api/faucet sends it. */
const DRIP = 25_000_000n;
/** The last balance read for each wallet, so a drip knows what it adds to. */
const lastBalance = new Map<string, bigint>();
/**
 * A drip that has landed but that the RPC node answering the next read may not have seen yet (a public RPC is many
 * nodes, some a block behind). Until a read shows the balance has moved off `before`, or `until` passes, every balance
 * on the page shows at least `min`, so "25 test AUSD arrived" is never followed by "$0.00 in your wallet".
 */
const expected = new Map<string, { before: bigint; min: bigint; until: number }>();
const expectListeners = new Set<() => void>();

export function useDollarBalance(address?: Address) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const refresh = useCallback(async () => {
    if (!address) return setBalance(null);
    const k = address.toLowerCase();
    try {
      const read = (await publicClient.readContract({ address: DOLLAR, abi: dollarAbi, functionName: "balanceOf", args: [address] })) as bigint;
      noteRpcOk();
      const x = expected.get(k);
      if (x && Date.now() < x.until && read === x.before) return setBalance((b) => (b != null && b > x.min ? b : x.min));
      expected.delete(k);
      lastBalance.set(k, read);
      setBalance(read);
    } catch (e) {
      noteRpcError(e);
    }
  }, [address]);
  useEffect(() => {
    // A new address starts unknown, never with the last one's balance.
    setBalance(null);
    refresh();
    const t = setInterval(() => !rpcResting() && refresh(), 2500);
    // A drip landing anywhere on the page shows here at once, then the read confirms it.
    const onExpect = () => {
      const x = address && expected.get(address.toLowerCase());
      if (x) setBalance((b) => (b != null && b > x.min ? b : x.min));
      refresh();
    };
    expectListeners.add(onExpect);
    return () => {
      clearInterval(t);
      expectListeners.delete(onExpect);
    };
  }, [refresh, address]);
  return { balance, refresh };
}

/** Faucet requests in flight, one per wallet. */
const drips = new Map<string, Promise<Landed>>();

/**
 * Asks the faucet for 25 test AUSD, sharing one request per wallet: the "Get 25 test AUSD" buttons and the
 * automatic first drip all call this, so a new account never gets (or spends a faucet turn on) two at once.
 */
export function dripOnce(address: Address): Promise<Landed> {
  const k = address.toLowerCase();
  let p = drips.get(k);
  if (!p) {
    // The automatic drip is once per wallet per browser session, whichever way it went out.
    try {
      sessionStorage.setItem(`till.drip.${k}`, "1");
    } catch {}
    const before = lastBalance.get(k) ?? 0n;
    p = requestTestDollars(address)
      .then((r) => {
        expected.set(k, { before, min: before + DRIP, until: Date.now() + 10_000 });
        expectListeners.forEach((f) => f());
        return r;
      })
      .finally(() => drips.delete(k));
    drips.set(k, p);
  }
  return p;
}

/**
 * A wallet that arrives empty gets 25 test AUSD without asking (once per wallet per browser session),
 * so the first screen a judge sees already has money on it. Only the first balance read for a wallet counts: an
 * account that spends down to zero later isn't topped up behind its back. A drip that fails says why in `error`
 * (the faucet's own reason, e.g. its once-an-hour limit); the manual button remains.
 */
export function useAutoDrip(address: Address | undefined, balance: bigint | null, onLanded?: () => void) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "failed">("idle");
  const [landed, setLanded] = useState<(Landed & { what: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The wallet whose first balance has been seen; later reads of the same wallet never start a drip.
  const arrived = useRef<string | null>(null);
  const lastAddress = useRef<string | undefined>(undefined);
  useEffect(() => {
    // In the render where the wallet changes, `balance` is still the previous wallet's; wait for this one's own read.
    const switched = lastAddress.current !== address;
    lastAddress.current = address;
    if (switched || !address || balance == null) return;
    const k = address.toLowerCase();
    if (arrived.current === k) return;
    arrived.current = k;
    if (balance > 0n) return setState("done");
    try {
      if (sessionStorage.getItem(`till.drip.${k}`)) return setState("done");
    } catch {}
    setState("sending");
    dripOnce(address)
      .then((r) => {
        setLanded({ ...r, what: "25 test AUSD arrived" });
        setState("done");
        onLanded?.();
      })
      .catch((e) => {
        setError(`Your first 25 test AUSD didn't arrive: ${plainError(e)}`);
        setState("failed");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, balance]);
  useEffect(() => {
    setState("idle");
    setLanded(null);
    setError(null);
  }, [address]);
  return { sending: state === "sending", landed, error };
}

const LAGGING = "history: block not indexed yet";

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
  // True until the first walk for this tab finishes: the lines shown meanwhile are only its newest few.
  const [loading, setLoading] = useState(true);
  const seen = useRef<{ id: string; head: bigint; lines: StubLine[] }>({ id: "", head: 0n, lines: [] });
  const walking = useRef(false);
  const queued = useRef<bigint | null>(null);
  const current = useRef("");
  const retries = useRef(0);
  const [again, setAgain] = useState(0);

  useEffect(() => () => void (current.current = ""), []);
  useEffect(() => {
    if (id == null || lastBlock == null) return;
    const sid = id.toString();
    current.current = sid;
    if (seen.current.id !== sid) {
      seen.current = { id: sid, head: 0n, lines: [] };
      retries.current = 0;
      setLines(null);
      setLoading(true);
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
        let prev: bigint | null = null;
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
        // Every block in the chain holds this tab's Activity link. Without it, the RPC node that answered is a block or
        // two behind the one that served the tab (a public RPC is many nodes): read again shortly instead of ending the
        // walk here, which would leave the newest lines (a close, its last payout) off the stub until a reload.
        if (prev == null) throw new Error(LAGGING);
        fresh.push(...inBlock.reverse());
        block = prev;
        steps++;
        // Show the stub as it is read, newest first, rather than after the whole walk.
        if (!cancelled() && (steps <= 3 || steps % 4 === 0)) setLines([...fresh, ...seen.current.lines]);
      }
      if (cancelled()) return;
      retries.current = 0;
      const merged = [...fresh, ...seen.current.lines].slice(0, 80);
      seen.current = { id: sid, head: lastBlock, lines: merged };
      setLines(merged);
      // A walk from a newer head down to the last one read leaves the older end as it was: still short if it was.
      const short = block > 0n && block !== stopAt;
      setMore((m) => short || (stopAt > 0n && m));
      setLoading(false);
    })()
      .catch((e) => {
        if (cancelled()) return;
        // Rate-limited, a node behind, or a failed read: walk again shortly rather than keep a stub that stops short.
        // A tab that has stopped changing (closed) gets no new head to trigger another walk, so this is its only retry.
        const limited = noteRpcError(e);
        const tries = ++retries.current;
        if (limited || tries <= 6) setTimeout(() => !cancelled() && setAgain((n) => n + 1), limited ? 4000 : 1000 * tries);
        else {
          setLines((l) => l ?? []);
          setLoading(false);
        }
      })
      .finally(() => {
        walking.current = false;
        if (!cancelled() && queued.current != null && queued.current !== seen.current.head) {
          queued.current = null;
          setAgain((n) => n + 1);
        }
      });
  }, [id, lastBlock, max, again]);

  return { lines, more, loading };
}
