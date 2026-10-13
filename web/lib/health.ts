"use client";
import { useEffect, useState } from "react";

export type Health = {
  status: "ok" | "payouts" | "low" | "out" | "empty" | "unknown";
  paused?: string[];
  /** The relayer's keys: how many share the work, and the smallest balance among them (test MON, decimal string). */
  pool?: { size: number; lowestMon: string };
};

/** The relayer's state from /api/health, refreshed every minute, so a page can say "paused" before anyone signs. */
export function useHealth(): Health | null {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    let alive = true;
    const look = () =>
      fetch("/api/health")
        .then((r) => r.json())
        .then((h: Health) => alive && setHealth(h))
        .catch(() => {});
    look();
    const t = setInterval(look, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return health;
}

/** True when the relayer would refuse this kind of action right now. */
export const gasPaused = (h: Health | null, tier: "settle" | "open" | "clockIn" | "essential") => !!h?.paused?.includes(tier);
