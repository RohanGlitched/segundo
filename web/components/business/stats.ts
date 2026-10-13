"use client";

import { useEffect, useState } from "react";

/** GET /api/stats: network-wide money read from the chain. Money fields are AUSD base units (6 dp) as strings. */
/** One slice of the network: tabs, payouts, pay sent (AUSD base units) and the wallets on them. */
export type Slice = { tabs: number; payouts: number; paid: string; clients: number; freelancers: number; wallets: number };

export type Stats = {
  updatedAt: string | number;
  treasury: string;
  /** Only transfers matched to an open or top-up count as fees. refunded/net arrive with the close-time fee refund. */
  fees: { total: string; count: number; last7d: string; refunded?: string; refunds?: number; net?: string };
  paid: { total: string; payouts: number; tabs: number; freelancers: number; clients: number };
  /** Tabs opened in the app by wallets other than our demo studios (our own test runs included). */
  outside?: Slice;
  /** Tabs our demo studios opened; studios and people are how many demo wallets we run. */
  demo?: Slice & { studios: number; people: number };
  /** Tabs opened straight on the contract, without the app (allowed by design; no fee is due). */
  direct?: Slice;
  /** The load benchmark, left out of every other figure. */
  bench?: { tabs: number; payouts: number };
  /** Opens and top-ups sent through Segundo since the fee went live, and how many paid it. */
  feeRate?: { opensWithFee: number; opens: number; direct: number; since: number; missed: { tab: string; kind: "open" | "topup"; block: number; hash: string }[] };
  /** Monad's average block time over the last `blocks` blocks, measured from the chain. */
  chain?: { blockMs: number; blocks: number; head: number } | null;
  daily: { day: string; paid: string; fees: string; payouts: number; tabs: number }[];
  /** Kept for older readers: the median gap between payouts on a running tab. Not shown anywhere. */
  settle: { medianMs: number | null };
  /** "envio-hyperrpc" when read through Envio, "rpc" when the public RPC fallback covers only a recent window. */
  source: string;
};

/** AUSD base units (a decimal string) to dollars. */
export const usdOf = (units: string | undefined | null): number => {
  if (!units) return 0;
  try {
    return Number(BigInt(units)) / 1e6;
  } catch {
    return 0;
  }
};

const isStats = (d: unknown): d is Stats => {
  const s = d as Stats | null;
  return !!s && typeof s === "object" && !!s.fees && !!s.paid && Array.isArray(s.daily);
};

/**
 * The stats feed, shared by /business and /deck. undefined while the first read is on its way,
 * null if the endpoint isn't answering (a later success replaces it; a later failure keeps the last good read).
 */
export function useStats(everyMs = 60_000) {
  const [stats, setStats] = useState<Stats | null | undefined>(undefined);
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/stats")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: unknown) => {
          if (stop) return;
          if (isStats(d)) setStats(d);
          else setStats((old) => old ?? null);
        })
        .catch(() => !stop && setStats((old) => old ?? null));
    load();
    const t = setInterval(load, everyMs);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [everyMs]);
  return stats;
}

/** $1,234.56 for small figures, $12.3k beyond ten thousand. */
export function money(usd: number, digits = 2): string {
  if (Math.abs(usd) >= 10_000) return `$${(usd / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k`;
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export const count = (n: number | undefined) => (n ?? 0).toLocaleString("en-US");
