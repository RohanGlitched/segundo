"use client";

import { useEffect, useState } from "react";

/** GET /api/stats: network-wide money read from the chain. Money fields are AUSD base units (6 dp) as strings. */
export type Stats = {
  updatedAt: string | number;
  treasury: string;
  fees: { total: string; count: number; last7d: string };
  paid: { total: string; payouts: number; tabs: number; freelancers: number; clients: number };
  daily: { day: string; paid: string; fees: string; payouts: number; tabs: number }[];
  /** The median gap between one payout and the next on a running tab. */
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
