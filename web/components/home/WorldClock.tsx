"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type RefObject } from "react";
import { DEMO_FREELANCERS } from "@/lib/demo";
import { LiveActive, useChainNow, useOnScreen, useRates } from "@/lib/live";
import { currency, formatMoney, toUsd } from "@/lib/money";
import { useNetwork } from "@/lib/network";
import { earnedAt, stateOf } from "@/lib/tabs";
import { Odometer } from "../Odometer";
import styles from "./home.module.css";

const ZONES: Record<string, string> = {
  Manila: "Asia/Manila",
  Lagos: "Africa/Lagos",
  Pune: "Asia/Kolkata",
  "São Paulo": "America/Sao_Paulo",
  Nairobi: "Africa/Nairobi",
};

function localTime(zone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return { h, m, label: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
}

/** Rounded so the server and the browser print identical numbers. */
const f2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A 24-hour dial: night is the dark half, the working day is the red arc, the hand is local time.
 * Drawn per city so the strip reads like a row of world clocks in a newsroom.
 */
function Dial({ h, m, working }: { h: number; m: number; working: boolean }) {
  const angle = ((h + m / 60) / 24) * Math.PI * 2 - Math.PI / 2;
  const arc = (from: number, to: number, r: number) => {
    const a0 = (from / 24) * Math.PI * 2 - Math.PI / 2;
    const a1 = (to / 24) * Math.PI * 2 - Math.PI / 2;
    const large = to - from > 12 ? 1 : 0;
    return `M${f2(50 + r * Math.cos(a0))} ${f2(50 + r * Math.sin(a0))} A${r} ${r} 0 ${large} 1 ${f2(50 + r * Math.cos(a1))} ${f2(50 + r * Math.sin(a1))}`;
  };
  return (
    <svg viewBox="0 0 100 100" className={styles.dial} aria-hidden>
      <circle cx="50" cy="50" r="44" fill="none" stroke="var(--rule)" strokeWidth="1" />
      <path d={arc(18, 30, 39)} fill="none" stroke="var(--ink)" strokeOpacity="0.16" strokeWidth="7" />
      <path d={arc(9, 18, 46.5)} fill="none" stroke="var(--serial)" strokeWidth="2" strokeOpacity={working ? 1 : 0.4} />
      {Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
        const r0 = i % 6 === 0 ? 30 : 33;
        return <line key={i} x1={f2(50 + r0 * Math.cos(a))} y1={f2(50 + r0 * Math.sin(a))} x2={f2(50 + 35 * Math.cos(a))} y2={f2(50 + 35 * Math.sin(a))} stroke="var(--ink-soft)" strokeWidth={i % 6 === 0 ? 1.4 : 0.7} />;
      })}
      <line x1="50" y1="50" x2={f2(50 + 40 * Math.cos(angle))} y2={f2(50 + 40 * Math.sin(angle))} stroke="var(--c)" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="50" cy="50" r="3.2" fill="var(--c)" />
    </svg>
  );
}

export function WorldClock() {
  // Off screen (or in a background tab) the clocks stop ticking; they catch up on return.
  const ref = useRef<HTMLUListElement>(null);
  const on = useOnScreen(ref);
  return (
    <LiveActive active={on}>
      <Clocks listRef={ref} />
    </LiveActive>
  );
}

function Clocks({ listRef }: { listRef: RefObject<HTMLUListElement | null> }) {
  const net = useNetwork();
  const { rates } = useRates();
  const chainNow = useChainNow();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  return (
    <ul ref={listRef} className={styles.world}>
      {DEMO_FREELANCERS.map((f) => {
        const cur = currency(f.currency);
        const t = now ? localTime(ZONES[f.place]!, now) : { h: 12, m: 0, label: "--:--" };
        const tab = net?.open
          .filter((v) => v.tab.payee.toLowerCase() === f.address.toLowerCase())
          .sort((a, b) => Number(b.tab.lastBlock - a.tab.lastBlock))[0];
        const state = tab ? stateOf(tab.tab, chainNow) : null;
        const working = state === "working";
        const usd = tab ? toUsd(earnedAt(tab.tab, chainNow)) : 0;
        const payer = tab ? net?.profiles[tab.tab.payer.toLowerCase()] : undefined;
        const status = working ? "On the clock" : t.h >= 9 && t.h < 18 ? "Between sessions" : "Off for the day";
        const body = (
          <>
            <Dial h={t.h} m={t.m} working={working} />
            <span className={styles.city}>
              {f.place} <span className="soft">{t.label}</span>
            </span>
            <span className={styles.person}>
              {f.name}
              {payer ? `, for ${payer.name}` : ""}
            </span>
            <span className={`denom ${styles.cityAmount}`}>
              {tab && rates ? <Odometer value={formatMoney(usd, cur, rates)} /> : "—"}
            </span>
            <span className={`${styles.cityState} ${working ? styles.on : ""}`}>
              {working && <i aria-hidden />}
              {status}
            </span>
          </>
        );
        return (
          // Each city prints in its currency's ink; the night ink takes over in dark mode (home.module.css).
          <li key={f.address} className={styles.cityItem} style={{ ["--c-day" as string]: cur.ink, ["--c-night" as string]: cur.inkNight }}>
            {tab ? (
              <Link href={`/tab/${tab.id}`} className={styles.cityLink}>
                {body}
              </Link>
            ) : (
              <div className={styles.cityLink}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
