"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { StubLine } from "@/lib/hooks";
import { formatUsd, toUsd } from "@/lib/money";
import styles from "./TimeCard.module.css";

/** Drawn one SVG unit to one CSS pixel at the card's own width, so labels keep their size on a phone. */
const W_DEFAULT = 1000;
const W_MIN = 280;
const H = 210;
const L = 56;
const R = 16;
const BAR_Y = 26;
const BAR_H = 26;
const CH_T = 78;
const CH_B = 184;

const hhmm = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * A punch-card view of the tab: every stretch on the clock as a red bar, pauses hatched, and the
 * money that reached the freelancer as a rising line with a tick for each payout. Built from the
 * pay stub, so every mark is a transaction on Monad.
 */
export function TimeCard({
  lines,
  now,
  earnedUsd,
  running,
  partial,
  loading,
  since,
}: {
  lines: StubLine[];
  now: number;
  earnedUsd: number;
  running: boolean;
  partial?: boolean;
  /** The history is still being read: draw what's in, but don't total it yet. */
  loading?: boolean;
  /** When the current session started (the tab's own `since`, unix seconds), for a shift that began before the lines read. */
  since?: number;
}) {
  // The card measures itself before paint and draws at that width: the chart fits inside it at any size, and text
  // stays at its CSS size instead of shrinking with a fixed-width drawing.
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(W_DEFAULT);
  const drawn = lines.length >= 2;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (inner > 0) setW(Math.max(W_MIN, Math.round(inner)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawn]);
  const events = [...lines].sort((a, b) => a.time - b.time || a.block - b.block);
  if (events.length < 2) return null;
  const t0 = events[0]!.time;
  // A closed tab's card ends at the close; an open one runs to now.
  const closed = events.some((e) => e.kind === "closed");
  const t1 = closed ? Math.max(events.at(-1)!.time, t0 + 1) : Math.max(now, events.at(-1)!.time + 1);
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R);

  const work: [number, number][] = [];
  const holds: [number, number][] = [];
  let inAt: number | null = null;
  let heldAt: number | null = null;
  // Whether any clock change has been read yet: the first one can end a session that began before these lines.
  let clockSeen = false;
  for (const e of events) {
    if (e.kind === "in") {
      inAt = e.time;
      clockSeen = true;
    }
    if (e.kind === "out" || e.kind === "held" || e.kind === "closed") {
      if (inAt != null) work.push([inAt, e.time]);
      // Every stop (clock out, pause, close) emits ClockedOut, so only that line can end a shift begun before these lines.
      else if (!clockSeen && e.kind === "out") work.push([t0, e.time]);
      inAt = null;
      if (e.kind === "out") clockSeen = true;
    }
    if (e.kind === "held") heldAt = e.time;
    if ((e.kind === "resumed" || e.kind === "closed") && heldAt != null) {
      holds.push([heldAt, e.time]);
      heldAt = null;
    }
  }
  // A session with no end in the lines read so far: running, it reaches now; stopped, it lasted at least until the
  // newest line (a payout or the close that ended it), never zero seconds.
  if (inAt != null) work.push([inAt, running ? t1 : Math.max(inAt, events.at(-1)!.time)]);
  // A long shift can start before the stretch of history on screen: the clock is running, so it fills the card from
  // the start of the shift (the tab's own clock-in time) or from the first line read, whichever is later.
  else if (running) work.push([since && since > t0 && since < t1 ? since : t0, t1]);
  const shiftBefore = running && inAt == null && since != null && since > 0 && since < t0 ? since : null;
  if (heldAt != null) holds.push([heldAt, t1]);

  let cum = 0;
  const paidPts: [number, number][] = [[t0, 0]];
  for (const e of events)
    if (e.kind === "paid" && e.amount != null) {
      paidPts.push([e.time, cum]);
      cum += toUsd(e.amount);
      paidPts.push([e.time, cum]);
    }
  paidPts.push([t1, cum]);
  // With only the latest stretch of history, scale the money line to what was paid in that stretch.
  const top = Math.max(partial ? cum : earnedUsd, cum, 0.000001);
  const y = (usd: number) => CH_B - (usd / top) * (CH_B - CH_T);
  const paidPath = paidPts.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const worked = work.reduce((s, [a, b]) => s + (b - a), 0);
  const workedText = worked < 90 ? `${Math.round(worked)} s` : `${Math.round(worked / 60)} min`;
  const sessions = `${work.length} ${work.length === 1 ? "session" : "sessions"}`;

  return (
    <figure className={styles.card} ref={box}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.svg}
        role="img"
        aria-label={loading ? "Time card: reading the history from Monad." : `Time card: ${workedText} on the clock across ${sessions}; ${formatUsd(cum, 4)} paid out.`}
      >
        <defs>
          <pattern id="tc-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink-soft)" strokeWidth="1.2" opacity="0.5" />
          </pattern>
        </defs>
        <text x="0" y={BAR_Y + 18} className={styles.lab}>
          Clock
        </text>
        <rect x={L} y={BAR_Y} width={W - L - R} height={BAR_H} rx="3" fill="var(--rule)" opacity="0.45" />
        {holds.map(([a, b], i) => (
          <rect key={`h${i}`} x={x(a)} y={BAR_Y} width={Math.max(1, x(b) - x(a))} height={BAR_H} fill="url(#tc-hatch)" />
        ))}
        {work.map(([a, b], i) => (
          <rect key={`w${i}`} x={x(a)} y={BAR_Y} width={Math.max(2, x(b) - x(a))} height={BAR_H} rx="2" fill="var(--serial)" />
        ))}
        <text x="0" y={CH_T + 12} className={styles.lab}>
          Paid
        </text>
        <line x1={L} x2={W - R} y1={CH_B} y2={CH_B} stroke="var(--rule)" />
        <path d={paidPath} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
        {events
          .filter((e) => e.kind === "paid")
          .map((e, i) => (
            <line key={`p${i}`} x1={x(e.time)} x2={x(e.time)} y1={CH_B} y2={CH_B + 7} stroke="var(--ink)" strokeWidth="1.2" />
          ))}
        <text x={L} y={H - 4} className={styles.lab}>
          {hhmm(t0)}
        </text>
        <text x={W - R} y={H - 4} textAnchor="end" className={styles.lab}>
          {running ? "now" : hhmm(t1)}
        </text>
        {!loading && (
          <text x={W - R} y={y(cum) - 8} textAnchor="end" className={styles.val}>
            {formatUsd(cum, cum < 1 ? 4 : 2)} paid out
          </text>
        )}
      </svg>
      <figcaption className={styles.cap} aria-live="polite">
        {loading ? (
          "Reading history…"
        ) : (
          <>
            {work.length === 0 && partial ? "No clock changes in this stretch of the history" : `${partial ? "In this stretch: " : ""}${workedText} on the clock across ${sessions}`}
            {holds.length ? `, paused ${holds.length} ${holds.length === 1 ? "time" : "times"}` : ""}
            {shiftBefore != null ? `; the current shift began at ${hhmm(shiftBefore)}` : ""}. Each tick is a payout transaction.
          </>
        )}
      </figcaption>
    </figure>
  );
}
