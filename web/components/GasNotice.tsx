"use client";
import { useHealth } from "@/lib/health";
import styles from "./GasNotice.module.css";

const WORDS: Record<string, string> = {
  payouts: "The relayer is saving test MON, so payouts while you watch are paused. Everything else works, and earned pay is paid out when a clock stops or a tab closes.",
  low: "The relayer is short of test MON, so new tabs, top-ups and transfers are paused while clock-ins, clock-outs and closes keep working. Earned pay is paid out at close.",
  out: "The relayer is short of test MON, so only clock-outs, pauses, closes and invite claims go through for the moment. Nothing earned is lost: it is paid out as soon as gas is back.",
  empty: "The relayer is out of test MON, so nothing can be sent for the moment. Nothing earned is lost: every cent is locked in the contract and is paid out as soon as gas is back.",
};

/** A thin bar under the header that only appears when the gasless path is short of MON. */
export function GasNotice() {
  const health = useHealth();
  const words = health && WORDS[health.status];
  if (!words) return null;
  return (
    <div className={styles.bar} role="status">
      <div className="wrap">{words}</div>
    </div>
  );
}
