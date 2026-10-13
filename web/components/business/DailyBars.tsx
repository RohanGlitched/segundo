"use client";

import { useState } from "react";
import { money } from "./stats";
import styles from "./parts.module.css";

type Point = { day: string; value: number };

const W = 600;
const H = 150;
const PAD = { l: 4, r: 4, t: 14, b: 4 };

const dayLabel = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

/** One series of daily money as thin bars, with a hover read-out and a table for screen readers. */
export function DailyBars({ title, points, tone }: { title: string; points: Point[]; tone: "serial" | "ink" }) {
  const [at, setAt] = useState<number | null>(null);
  const max = Math.max(...points.map((p) => p.value), 0);
  const n = points.length;
  const slot = (W - PAD.l - PAD.r) / Math.max(n, 1);
  const bar = Math.max(2, Math.min(18, slot - 2));
  const y = (v: number) => (max > 0 ? H - PAD.b - (v / max) * (H - PAD.t - PAD.b) : H - PAD.b);
  const total = points.reduce((a, p) => a + p.value, 0);
  const hot = at != null ? points[at] : null;

  return (
    <figure className={styles.daily}>
      <figcaption className={styles.dailyHead}>
        <span>{title}</span>
        <span className={styles.dailyRead}>
          {hot ? (
            <>
              {dayLabel(hot.day)}: <b className="denom">{money(hot.value)}</b>
            </>
          ) : (
            <>
              {n} {n === 1 ? "day" : "days"}: <b className="denom">{money(total)}</b>
            </>
          )}
        </span>
      </figcaption>
      {n === 0 ? (
        <p className={styles.dailyEmpty}>No days recorded yet.</p>
      ) : (
        <div className={styles.dailyPlot} onPointerLeave={() => setAt(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${title}, ${n} days, ${money(total)} in all.`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--ink)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            {max > 0 && <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t} y2={PAD.t} stroke="var(--rule)" strokeWidth="1" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
            {points.map((p, i) => {
              const cx = PAD.l + slot * i + slot / 2;
              const top = y(p.value);
              const h = Math.max(p.value > 0 ? 2 : 0, H - PAD.b - top);
              return (
                <g key={p.day}>
                  <rect
                    x={cx - bar / 2}
                    y={H - PAD.b - h}
                    width={bar}
                    height={h}
                    rx={Math.min(2, bar / 3)}
                    className={tone === "serial" ? styles.barSerial : styles.barInk}
                    opacity={at == null || at === i ? 1 : 0.4}
                  />
                  <rect x={PAD.l + slot * i} y={0} width={slot} height={H} fill="transparent" onPointerEnter={() => setAt(i)} />
                </g>
              );
            })}
          </svg>
          {max > 0 && <span className={styles.dailyMax}>{money(max)}</span>}
        </div>
      )}
      {n > 0 && (
        <div className={styles.dailyAxis} aria-hidden>
          <span>{dayLabel(points[0]!.day)}</span>
          <span>{dayLabel(points[n - 1]!.day)}</span>
        </div>
      )}
      <table className="visually-hidden">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.day}>
              <td>{dayLabel(p.day)}</td>
              <td>{money(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
