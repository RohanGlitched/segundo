import { ringPath, ringsFor } from "@/lib/guilloche";
import styles from "./parts.module.css";

const STEPS = [
  { t: "A studio opens a tab", d: "and sends one invite link. No bank details to collect from anyone." },
  { t: "The link onboards a freelancer", d: "with a passkey in under a minute: a wallet they never have to see, and no gas." },
  { t: "They're paid by the second", d: "and watch the note print in the money they think in, instead of waiting ten days." },
  { t: "They bring their next client", d: "by asking them to open a tab instead of waiting on an invoice, and the loop starts again." },
];

// A light engraved ring behind the loop: three strands, drawn once on the server.
const RINGS = ringsFor(4242, 3).map((r, i) => ringPath(150, 150, 118, { ...r, scale: [0.82, 0.9, 1][i]! }));
const POINTS = [
  [150, 22],
  [278, 150],
  [150, 278],
  [22, 150],
] as const;

/** The viral loop: every tab onboards a freelancer, every freelancer brings the next client. */
export function Loop() {
  return (
    <div className={styles.loop}>
      <svg viewBox="0 0 300 300" className={styles.loopArt} aria-hidden>
        {RINGS.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="var(--ink)" strokeWidth="0.6" opacity={0.28 + i * 0.1} />
        ))}
        <circle cx="150" cy="150" r="128" fill="none" stroke="var(--serial)" strokeWidth="1.6" strokeDasharray="4 6" />
        {[45, 135, 225, 315].map((a) => {
          const r = (a * Math.PI) / 180;
          const x = 150 + 128 * Math.sin(r);
          const y = 150 - 128 * Math.cos(r);
          return <path key={a} d="M-5 -5 L4 0 L-5 5" transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${a})`} fill="none" stroke="var(--serial)" strokeWidth="2" />;
        })}
        {POINTS.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="17" fill="var(--paper)" stroke="var(--ink)" strokeWidth="1.5" />
            <text x={x} y={y + 6} textAnchor="middle" className={styles.loopNo}>
              {i + 1}
            </text>
          </g>
        ))}
      </svg>
      <ol className={styles.loopSteps}>
        {STEPS.map((s, i) => (
          <li key={s.t}>
            <span className={`denom ${styles.loopIdx}`} aria-hidden>
              {i + 1}
            </span>
            <p>
              <b>{s.t}</b> {s.d}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
