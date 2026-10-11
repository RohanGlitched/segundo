"use client";
import { useEffect, useState } from "react";
import styles from "./GasNotice.module.css";

type Health = { status: "ok" | "low" | "out" | "unknown"; paused?: string[] };

const WORDS: Record<string, string> = {
  low: "The relayer is low on test MON, so new tabs, top-ups and transfers are paused while clock-ins, clock-outs and closes keep working. Pay already earned is paid out at close.",
  out: "The relayer is out of test MON, so only clock-outs and closes go through for the moment. Nothing earned is lost: it is paid out as soon as gas is back.",
};

/** A thin bar under the header that only appears when the gasless path is short of MON. */
export function GasNotice() {
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
  const words = health && WORDS[health.status];
  if (!words) return null;
  return (
    <div className={styles.bar} role="status">
      <div className="wrap">{words}</div>
    </div>
  );
}
