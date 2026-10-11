"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { bandPaths, bandsFor, ringPath, ringsFor, seedOf, wavePath } from "@/lib/guilloche";
import { currency as currencyOf, formatUsd, noteParts, type Currency, type Rates } from "@/lib/money";
import { Odometer } from "./Odometer";
import styles from "./Note.module.css";

export type NoteProps = {
  id: bigint | number;
  usd: number; // live amount earned, in USD
  cur: Currency;
  rates: Rates | null;
  payee: { name: string; place: string };
  payer: { name: string; place: string };
  rateUsd: number; // per hour
  hours: number; // hours worked so far (drives the bands)
  live: boolean; // clock running
  status: string; // one plain line, e.g. "On the clock for 41 min"
  serialLine?: string; // e.g. "block 67,912,113, paid 2 seconds ago"
  engrave?: boolean; // engrave the lines in once on first show
  lines?: { main: React.ReactNode; extra?: React.ReactNode; sub?: React.ReactNode }; // replaces the "Paid to / by" lines
};

const W = 1100;
const H = 500;
const CX = 292;
const CY = 250;
const SIZE = 196;
const BAND_MINUTES = [2, 5, 10, 20, 40, 60, 120];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "T";

/** A tab drawn as a banknote that prints itself while the freelancer works. */
export function Note(p: NoteProps) {
  const seed = seedOf("till", p.id.toString());
  const core = useMemo(() => ringsFor(seed, 2).map((r, i) => ringPath(CX, CY, SIZE * (i ? 0.33 : 0.29), { ...r, scale: 1 })), [seed]);
  const bands = useMemo(() => bandsFor(seed, 7), [seed]);
  const paths = useMemo(() => bands.map((b) => bandPaths(CX, CY, SIZE, b)), [bands]);
  const border = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < 3; i++) {
      const ph = (i * Math.PI * 2) / 3;
      out.push(wavePath(34, 28, W - 68, 7, 34, ph));
      out.push(wavePath(34, H - 28, W - 68, 7, 34, ph + 1));
      out.push(wavePath(28, 34, H - 68, 7, 34, ph, true));
      out.push(wavePath(W - 28, 34, H - 68, 7, 34, ph + 2, true));
    }
    return out;
  }, []);

  // Bands engrave quickly at first and slower later (2, 5, 10, 20, 40, 60, 120 minutes), so a tab
  // shows its first band within minutes and a long one keeps growing for hours.
  const minutes = p.hours * 60;
  let done = 0;
  let progress = 0;
  let acc = 0;
  for (const span of BAND_MINUTES) {
    if (minutes >= acc + span) {
      done++;
      acc += span;
    } else {
      progress = (minutes - acc) / span;
      break;
    }
  }
  const current = done >= 7 ? 6 : done;
  if (done >= 7) progress = ((minutes - acc) % 120) / 120;
  done = Math.min(done, 7);
  // Without exchange rates the note still prints, in dollars.
  const cur = p.cur.code !== "USD" && !p.rates?.[p.cur.code] ? currencyOf("USD") : p.cur;
  const parts = noteParts(p.usd, cur, p.rates);
  const serial = `№ ${p.id.toString().padStart(4, "0")}`;
  // Long amounts (naira, shillings, rupiah) shrink to stay inside the note instead of clipping their
  // last digits: a first guess from the digit count, then a measurement once the note is on screen.
  const chars = parts ? parts.whole.length + (parts.frac ? 0.5 + parts.frac.length * 0.5 : 0) + parts.symbol.length * 0.6 : 0;
  const guess = chars > 9.5 ? 9.5 / chars : 1;
  const amountRef = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState(1);
  useLayoutEffect(() => {
    const el = amountRef.current;
    if (!el) return;
    el.style.setProperty("--shrink", String(guess));
    const r = el.scrollWidth > 0 ? el.clientWidth / el.scrollWidth : 1;
    setFit(r < 0.995 ? Math.max(0.5, r * 0.96) : 1);
  }, [guess, parts?.whole.length, parts?.frac?.length]);
  const shrink = guess * fit;
  const microprint = `${p.payee.name} ${p.payee.place} ${serial} paid by ${p.payer.name} `.repeat(14);

  return (
    <figure
      className={`${styles.note} ${p.engrave ? styles.engrave : ""} ${p.live ? styles.isLive : ""}`}
      style={{ ["--note-ink" as string]: cur.ink, ["--note-ink-night" as string]: cur.inkNight }}
      aria-label={`Tab ${serial}: ${parts ? `${parts.symbol}${parts.whole}.${parts.frac}` : formatUsd(p.usd)} earned by ${p.payee.name}. ${p.status}.`}
    >
      <svg className={styles.art} viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <defs>
          <pattern id={`waves-${seed}`} width="60" height="9" patternUnits="userSpaceOnUse">
            <path d="M0 4.5 Q15 0.5 30 4.5 T60 4.5" fill="none" stroke="currentColor" strokeWidth="0.6" />
          </pattern>
          <radialGradient id={`glow-${seed}`}>
            <stop offset="0" stopColor="var(--note-paper)" stopOpacity="1" />
            <stop offset="1" stopColor="var(--note-paper)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} rx="14" className={styles.paper} />
        <rect x="40" y="40" width={W - 80} height={H - 80} fill={`url(#waves-${seed})`} className={styles.lithograph} />
        <circle cx={CX} cy={CY} r={SIZE + 22} fill={`url(#glow-${seed})`} />
        <g className={styles.border}>
          {border.map((d, i) => (
            <path key={i} d={d} pathLength={1} />
          ))}
        </g>
        <rect x="46" y="46" width={W - 92} height={H - 92} rx="6" className={styles.frame} />
        <g className={styles.watermark}>
          {paths.flat().map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        <g className={styles.rings}>
          {core.map((d, i) => (
            <path key={`c${i}`} d={d} strokeWidth={0.6} pathLength={1} />
          ))}
          {paths.slice(0, done >= 7 ? 6 : done).map((band, i) =>
            band.map((d, j) => <path key={`${i}-${j}`} d={d} strokeWidth={bands[i]!.weight} pathLength={1} />),
          )}
          {progress > 0.001 &&
            paths[current]!.map((d, j) => (
              <path
                key={`cur-${current}-${j}`}
                d={d}
                className={p.live ? styles.current : undefined}
                strokeWidth={bands[current]!.weight + 0.15}
                pathLength={1}
                style={{ strokeDasharray: 1, strokeDashoffset: 1 - progress }}
              />
            ))}
        </g>
        <circle cx={CX} cy={CY} r="46" className={styles.medallion} />
        <text x={CX} y={CY + 15} textAnchor="middle" className={styles.monogram}>
          {initials(p.payee.name)}
        </text>
        <text x="58" y={H - 54} className={styles.micro}>
          {microprint.slice(0, 260)}
        </text>
      </svg>

      <div className={styles.face}>
        <span className={`serial ${styles.serialTop}`}>{serial}</span>
        <div className={styles.value}>
          <span className={styles.curName}>{cur.name}</span>
          <span ref={amountRef} className={`denom ${styles.amount}`} style={{ ["--shrink" as string]: shrink }}>
            {parts ? (
              <>
                <span className={styles.symbol}>{parts.symbol}</span>
                <Odometer value={parts.whole} />
                {parts.frac && (
                  <span className={styles.frac}>
                    .<Odometer value={parts.frac} />
                  </span>
                )}
              </>
            ) : (
              <span className={styles.symbol}>—</span>
            )}
          </span>
          <span className={styles.usd}>{p.lines?.sub ?? `${formatUsd(p.usd, 4)} in AUSD`}</span>
          <span className={styles.who}>
            {p.lines ? (
              p.lines.main
            ) : (
              <>
                Paid to <b>{p.payee.name}</b>
                {p.payee.place ? `, ${p.payee.place}` : ""}
              </>
            )}
          </span>
          <span className={`${styles.who} ${styles.extra}`}>
            {p.lines ? p.lines.extra : [`by ${p.payer.name}`, p.payer.place, `at ${formatUsd(p.rateUsd)} an hour`].filter(Boolean).join(", ")}
          </span>
        </div>
        <div className={styles.foot}>
          <span className={styles.status}>
            {p.live && <i className={styles.dot} aria-hidden />}
            {p.status}
          </span>
          {p.serialLine && <span className={`serial ${styles.serialLine}`}>{p.serialLine}</span>}
        </div>
      </div>
    </figure>
  );
}
