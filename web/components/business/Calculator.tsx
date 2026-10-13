"use client";

import { useId, useState } from "react";
import styles from "./parts.module.css";

type Key = "people" | "hours" | "rate" | "days" | "yieldPct" | "feePct";
type Field = { key: Key; label: string; hint: string; min: number; max: number; step: number; prefix?: string; suffix?: string };

const FIELDS: Field[] = [
  { key: "people", label: "Freelancers on Segundo", hint: "Each on one or more tabs", min: 1, max: 1_000_000, step: 1 },
  { key: "hours", label: "Hours each works a week", hint: "Billed hours on the clock", min: 1, max: 80, step: 1, suffix: "h" },
  { key: "rate", label: "Average hourly rate", hint: "In dollars", min: 1, max: 500, step: 1, prefix: "$" },
  { key: "days", label: "Days a budget waits in escrow", hint: "From funding to being paid out, on average", min: 0, max: 90, step: 1, suffix: "days" },
  { key: "yieldPct", label: "Reserve yield shared with Segundo", hint: "Our assumption, a year. Agora publishes no partner rate.", min: 0, max: 6, step: 0.25, suffix: "%" },
  { key: "feePct", label: "Segundo fee, paid by the client", hint: "1% today", min: 0, max: 5, step: 0.1, suffix: "%" },
];

const PRESETS: { name: string; v: Partial<Record<Key, number>> }[] = [
  { name: "One studio", v: { people: 8, hours: 30, rate: 25 } },
  { name: "An agency", v: { people: 150, hours: 35, rate: 20 } },
  { name: "One corridor", v: { people: 10_000, hours: 25, rate: 15 } },
];

const START: Record<Key, number> = { people: 150, hours: 35, rate: 20, days: 10, yieldPct: 1, feePct: 1 };
const WEEKS_A_MONTH = 52 / 12;

const usd = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`
    : `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2, minimumFractionDigits: n >= 100 ? 0 : 2 })}`;

/**
 * Unit economics in one place: the client fee on hours worked, the float on budgets waiting in escrow,
 * and what the same hours would have cost the freelancer through a marketplace or a wire.
 */
export function Calculator({ marketFee, marketLabel, wireCost }: { marketFee: number; marketLabel: string; wireCost: number }) {
  const id = useId();
  const [raw, setRaw] = useState<Record<Key, string>>(() => Object.fromEntries(Object.entries(START).map(([k, v]) => [k, String(v)])) as Record<Key, string>);
  const num = (k: Key) => {
    const f = FIELDS.find((x) => x.key === k)!;
    const n = Number(raw[k]);
    return Number.isFinite(n) ? Math.min(f.max, Math.max(f.min, n)) : f.min;
  };

  const people = num("people");
  const volume = people * num("hours") * num("rate") * WEEKS_A_MONTH;
  const fee = volume * (num("feePct") / 100);
  // The average balance waiting in escrow is a day's volume times the days it waits; yield accrues on that balance.
  const float = ((volume * 12) / 365) * num("days") * (num("yieldPct") / 100 / 12);
  const revenue = fee + float;
  const lostMarket = volume * marketFee;
  const lostWire = volume * wireCost;

  const set = (k: Key, v: string) => setRaw((r) => ({ ...r, [k]: v }));
  const preset = (v: Partial<Record<Key, number>>) => setRaw((r) => ({ ...r, ...Object.fromEntries(Object.entries(v).map(([k, n]) => [k, String(n)])) }));

  return (
    <div className={styles.calc}>
      <form className={styles.calcIn} onSubmit={(e) => e.preventDefault()} aria-label="Assumptions">
        <div className={styles.presets} role="group" aria-label="Start from an example">
          {PRESETS.map((p) => (
            <button key={p.name} type="button" className="btn small quiet" onClick={() => preset(p.v)}>
              {p.name}
            </button>
          ))}
        </div>
        {FIELDS.map((f) => (
          <div className={styles.calcField} key={f.key}>
            <label htmlFor={`${id}-${f.key}`}>{f.label}</label>
            <div className={styles.calcInput}>
              {f.prefix && <span aria-hidden>{f.prefix}</span>}
              <input
                id={`${id}-${f.key}`}
                className="input"
                type="number"
                inputMode="decimal"
                min={f.min}
                max={f.max}
                step={f.step}
                value={raw[f.key]}
                onChange={(e) => set(f.key, e.target.value)}
                onBlur={() => set(f.key, String(num(f.key)))}
                aria-describedby={`${id}-${f.key}-hint`}
              />
              {f.suffix && <span aria-hidden>{f.suffix}</span>}
            </div>
            <span id={`${id}-${f.key}-hint`} className={f.key === "yieldPct" ? styles.assume : styles.hint}>
              {f.hint}
            </span>
          </div>
        ))}
      </form>

      <div className={styles.calcOut} aria-live="polite">
        <p className={styles.stubHead}>A month at this size</p>
        <dl className={styles.stub}>
          <div>
            <dt>Hours paid through Segundo</dt>
            <dd className="denom">{usd(volume)}</dd>
          </div>
          <div>
            <dt>Client fee ({num("feePct").toLocaleString("en-US")}%)</dt>
            <dd className="denom">{usd(fee)}</dd>
          </div>
          <div>
            <dt>Share of reserve yield (assumed)</dt>
            <dd className="denom">{usd(float)}</dd>
          </div>
          <div className={styles.stubTotal}>
            <dt>Segundo revenue a month</dt>
            <dd className="denom">{usd(revenue)}</dd>
          </div>
          <div className={styles.stubSub}>
            <dt>A year, at this size</dt>
            <dd className="denom">{usd(revenue * 12)}</dd>
          </div>
          <div className={styles.stubSub}>
            <dt>Per freelancer, a month</dt>
            <dd className="denom">{usd(revenue / people)}</dd>
          </div>
        </dl>
        <p className={styles.stubHead}>What the same hours cost freelancers elsewhere, a month</p>
        <dl className={styles.stub}>
          <div>
            <dt>{marketLabel}</dt>
            <dd className={`denom ${styles.loss}`}>{usd(lostMarket)}</dd>
          </div>
          <div>
            <dt>Sent by wire at the {(wireCost * 100).toLocaleString("en-US")}% world average</dt>
            <dd className={`denom ${styles.loss}`}>{usd(lostWire)}</dd>
          </div>
          <div className={styles.stubTotal}>
            <dt>On Segundo</dt>
            <dd className="denom">$0</dd>
          </div>
        </dl>
        <p className={styles.hint}>
          A month is 52 ÷ 12 weeks. The yield line is an assumption, not a published rate; set it to 0 to see the fee alone.
        </p>
      </div>
    </div>
  );
}
