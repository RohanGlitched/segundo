"use client";

import Link from "next/link";
import { useMemo } from "react";
import { bandPaths, bandsFor, seedOf } from "@/lib/guilloche";
import { useChainNow, useLive } from "@/lib/live";
import { currency, formatCents, formatMoney, formatUsd, toUsd } from "@/lib/money";
import { STATE_WORDS, earnedAt, stateOf, type Profile, type TabView } from "@/lib/tabs";
import { Odometer } from "./Odometer";
import { personOf } from "./TabNote";
import styles from "./TabRow.module.css";

export function MiniRosette({ id, ink, size = 44, live }: { id: bigint; ink: string; size?: number; live?: boolean }) {
  const paths = useMemo(() => {
    const seed = seedOf("till", id.toString());
    return bandsFor(seed, 3).flatMap((b, i) => bandPaths(50, 50, 52, { ...b, radius: 0.42 + i * 0.2, strands: 5 }));
  }, [id]);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className={live ? styles.spin : undefined}>
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={ink} strokeWidth={1.1} opacity={0.85} />
      ))}
    </svg>
  );
}

/** One tab in a list: who, what rate, live money, state, and the one action that matters most. */
export function TabRow({
  view,
  me,
  profiles,
  action,
}: {
  view: TabView;
  me: string;
  profiles: Record<string, Profile>;
  action?: React.ReactNode;
}) {
  const now = useChainNow();
  const { rates } = useLive();
  const t = view.tab;
  const iAmPayee = t.payee.toLowerCase() === me.toLowerCase();
  const other = personOf(iAmPayee ? t.payer : t.payee, profiles, iAmPayee ? "" : "invited by link");
  const payee = personOf(t.payee, profiles);
  const cur = currency(payee.currency);
  const earned = toUsd(earnedAt(t, now));
  const budget = toUsd(t.budget);
  const state = stateOf(t, now);
  const shown = iAmPayee && rates ? formatMoney(earned, cur, rates) : formatCents(earned);

  return (
    <li className={styles.row}>
      <Link href={`/tab/${view.id}`} className={styles.main}>
        <MiniRosette id={view.id} ink={cur.ink} live={state === "working"} />
        <span className={styles.who}>
          <b>{iAmPayee ? `From ${other.name}` : `To ${other.name}`}</b>
          <span className={styles.meta}>
            {other.place ? `${other.place}, ` : ""}
            {formatUsd(toUsd(t.rate))} an hour, budget {formatUsd(budget)}
          </span>
        </span>
        <span className={styles.money}>
          <span className={`denom ${styles.amount}`}>
            <Odometer value={shown} />
          </span>
          <span className={`${styles.state} ${state === "working" ? styles.working : ""}`}>
            {state === "working" && <i aria-hidden />}
            {iAmPayee ? STATE_WORDS[state] : `${STATE_WORDS[state]}, ${Math.round((earned / Math.max(budget, 1e-9)) * 100)}% of budget used`}
          </span>
        </span>
      </Link>
      {action && <div className={styles.action}>{action}</div>}
      <span className="serial visually-hidden">№ {view.id.toString()}</span>
    </li>
  );
}
