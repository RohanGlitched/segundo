"use client";

import { Fragment, useId, useState } from "react";
import styles from "./parts.module.css";

type Key = "people" | "hours" | "rate" | "days" | "yieldPct" | "feePct" | "settleEvery" | "monPrice" | "gasGwei";
type Field = {
  key: Key;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  prefix?: string;
  suffix?: string;
  /** Shown in the warning colour: a figure we chose, not one we measured or were quoted. */
  assumption?: boolean;
  group: "work" | "network";
};

const FIELDS: Field[] = [
  { key: "people", label: "Freelancers on Segundo", hint: "Each on one tab at a time", min: 1, max: 1_000_000, step: 1, group: "work" },
  { key: "hours", label: "Hours each works a week", hint: "Billed hours on the clock", min: 1, max: 80, step: 1, suffix: "h", group: "work" },
  { key: "rate", label: "Average hourly rate", hint: "In dollars", min: 1, max: 500, step: 1, prefix: "$", group: "work" },
  { key: "days", label: "Days a budget waits in escrow", hint: "From funding to being paid out, on average", min: 0, max: 90, step: 1, suffix: "days", group: "work" },
  {
    key: "yieldPct",
    label: "Reserve yield shared with Segundo",
    hint: "Our assumption, a year. Agora publishes no partner rate.",
    min: 0,
    max: 6,
    step: 0.25,
    suffix: "%",
    assumption: true,
    group: "work",
  },
  { key: "feePct", label: "Segundo fee, on what clients spend", hint: "1% today. Unspent budget and its fee come back.", min: 0, max: 5, step: 0.1, suffix: "%", group: "work" },
  {
    key: "settleEvery",
    label: "Relayer pays a running tab every",
    hint: "Seconds between payouts. A tab on screen asks every few seconds; the relayer can cap it.",
    min: 2,
    max: 3600,
    step: 1,
    suffix: "s",
    group: "network",
  },
  {
    key: "monPrice",
    label: "MON price, for mainnet gas",
    hint: "Our conservative assumption: above MON's all-time high of $0.049 and about twice the $0.022 The Block showed in October 2026.",
    min: 0.001,
    max: 20,
    step: 0.005,
    prefix: "$",
    assumption: true,
    group: "network",
  },
  {
    key: "gasGwei",
    label: "Gas price",
    hint: "102 on every relayer receipt we measured; Monad's mainnet minimum base fee is 100.",
    min: 1,
    max: 2000,
    step: 1,
    suffix: "MON-gwei",
    group: "network",
  },
];

const PRESETS: { name: string; v: Partial<Record<Key, number>> }[] = [
  { name: "One studio", v: { people: 8, hours: 30, rate: 25 } },
  { name: "An agency", v: { people: 150, hours: 35, rate: 20 } },
  { name: "One corridor", v: { people: 10_000, hours: 25, rate: 15 } },
];

const START: Record<Key, number> = { people: 150, hours: 35, rate: 20, days: 10, yieldPct: 1, feePct: 1, settleEvery: 60, monPrice: 0.05, gasGwei: 102 };
const WEEKS_A_MONTH = 52 / 12;
/** Hours per clock-in, our assumption: each shift costs one clock-in and one clock-out. */
const SHIFT_HOURS = 4;

/**
 * Gas per action, averaged over Segundo's relayer receipts on Monad testnet (relayer 0xe77f…ABF40), read on
 * October 13, 2026. Monad charges the gas limit, and on these receipts gas used equals the limit.
 */
export const GAS = {
  /** settle(id) on one tab: 277 transactions. */
  settle: 97_673,
  /** openWithPermit through the forwarder: 5 transactions. */
  open: 512_162,
  /** topUpWithPermit through the forwarder: 48 transactions. */
  topUp: 261_664,
  /** The 1% fee, an AUSD transferWithAuthorization: 6 transactions. Fee refunds are the same call. */
  fee: 113_517,
  /** clockIn through the forwarder: 21 transactions. */
  clockIn: 123_712,
  /** clockOut through the forwarder: 17 transactions. */
  clockOut: 124_872,
  /** close through the forwarder: 1 transaction. */
  close: 180_670,
};

const usd = (n: number) =>
  Math.abs(n) >= 1_000_000
    ? `${n < 0 ? "−" : ""}$${(Math.abs(n) / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`
    : `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2, minimumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 })}`;
/** Small amounts (a cent or less) need more places to say anything. */
const cents = (n: number) =>
  Math.abs(n) >= 1 ? usd(n) : Math.abs(n) >= 0.1 ? `$${n.toFixed(2)}` : `$${n.toLocaleString("en-US", { maximumSignificantDigits: 3 })}`;
const mon = (n: number) => `${n.toLocaleString("en-US", { maximumSignificantDigits: 3 })} MON`;

/**
 * Unit economics in one place: the client fee on hours worked, the float on budgets waiting in escrow, what the
 * relayer spends on gas to keep everything free for both sides, and what the same hours would have cost the
 * freelancer through a marketplace or a wire.
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
  const hoursMonth = num("hours") * WEEKS_A_MONTH;
  const volume = people * hoursMonth * num("rate");
  const feeRate = num("feePct") / 100;
  const fee = volume * feeRate;
  // The average balance waiting in escrow is a day's volume times the days it waits; yield accrues on that balance.
  const float = ((volume * 12) / 365) * num("days") * (num("yieldPct") / 100 / 12);

  // Relayer gas for one freelancer-month: payouts while on the clock, a clock-in and out per shift, and a weekly
  // budget (one open, then a top-up each week, each with its fee transfer), closed once with its fee refund.
  const payouts = (hoursMonth * 3600) / num("settleEvery");
  const fixedGas =
    (hoursMonth / SHIFT_HOURS) * (GAS.clockIn + GAS.clockOut) +
    GAS.open +
    (WEEKS_A_MONTH - 1) * GAS.topUp +
    WEEKS_A_MONTH * GAS.fee +
    GAS.close +
    GAS.fee;
  const gasMonth = payouts * GAS.settle + fixedGas;
  const monPerGas = num("gasGwei") * 1e-9;
  const monMonth = gasMonth * monPerGas;
  const gasUsdMonth = monMonth * num("monPrice");
  const gasTabHour = gasUsdMonth / hoursMonth;
  const monTabHour = monMonth / hoursMonth;
  const gasAll = gasUsdMonth * people;

  const revenue = fee + float;
  const net = revenue - gasAll;
  const feePerFreelancer = fee / people;
  const netPerFreelancer = net / people;
  // Break-even: the MON price at which gas eats the whole fee, and the fastest payout pace the fee pays for today.
  const breakEvenMon = monMonth > 0 ? feePerFreelancer / monMonth : Infinity;
  const affordablePayouts = (feePerFreelancer / (monPerGas * num("monPrice")) - fixedGas) / GAS.settle;
  const fastestEvery = affordablePayouts > 0 ? (hoursMonth * 3600) / affordablePayouts : null;

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
        {FIELDS.map((f, i) => (
          <Fragment key={f.key}>
            {f.group === "network" && FIELDS[i - 1]?.group !== "network" && (
              <p className={styles.calcGroup}>What the relayer pays so neither side ever needs gas</p>
            )}
            <div className={styles.calcField}>
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
              <span id={`${id}-${f.key}-hint`} className={f.assumption ? styles.assume : styles.hint}>
                {f.hint}
              </span>
            </div>
          </Fragment>
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
            <dt>Client fee ({num("feePct").toLocaleString("en-US")}% of what they spend)</dt>
            <dd className="denom">{usd(fee)}</dd>
          </div>
          <div>
            <dt>Share of reserve yield (assumed)</dt>
            <dd className="denom">{usd(float)}</dd>
          </div>
          <div>
            <dt>Relayer gas, at ${num("monPrice").toLocaleString("en-US")} a MON</dt>
            <dd className={`denom ${styles.cost}`}>−{usd(gasAll)}</dd>
          </div>
          <div className={styles.stubTotal}>
            <dt>Segundo net revenue a month</dt>
            <dd className="denom">{usd(net)}</dd>
          </div>
          <div className={styles.stubSub}>
            <dt>A year, at this size</dt>
            <dd className="denom">{usd(net * 12)}</dd>
          </div>
        </dl>

        <p className={styles.stubHead}>Per freelancer</p>
        <dl className={styles.stub}>
          <div className={styles.stubSub}>
            <dt>Relayer gas per tab-hour</dt>
            <dd className="denom">
              {cents(gasTabHour)} <small className={styles.monNote}>{mon(monTabHour)}</small>
            </dd>
          </div>
          <div className={styles.stubSub}>
            <dt>Fee per tab-hour</dt>
            <dd className="denom">{cents(feeRate * num("rate"))}</dd>
          </div>
          <div className={styles.stubSub}>
            <dt>Net revenue per freelancer-month</dt>
            <dd className={`denom ${netPerFreelancer < 0 ? styles.cost : ""}`}>{usd(netPerFreelancer)}</dd>
          </div>
        </dl>
        <p className={styles.breakEven}>
          <b>Break-even.</b>{" "}
          {Number.isFinite(breakEvenMon) && breakEvenMon > 0 ? (
            <>
              At this pace the fee alone covers gas until MON reaches <b className="denom">{cents(breakEvenMon)}</b>
              {breakEvenMon > num("monPrice") ? `, ${(breakEvenMon / num("monPrice")).toLocaleString("en-US", { maximumFractionDigits: 1 })}× the price above` : ""}.
            </>
          ) : (
            "With no fee, every payout is a cost."
          )}{" "}
          {fastestEvery ? (
            <>
              At ${num("monPrice").toLocaleString("en-US")} a MON, the fee pays for a payout as often as every{" "}
              <b className="denom">{fastestEvery < 10 ? fastestEvery.toFixed(1) : Math.round(fastestEvery).toLocaleString("en-US")} s</b>.
            </>
          ) : (
            "At this MON price the fee doesn't cover the opens, closes and clock-ins, before any payout."
          )}
        </p>

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
          A month is 52 ÷ 12 weeks. Gas per action is the average over Segundo&apos;s relayer receipts on Monad testnet, read October 13, 2026: a payout{" "}
          {GAS.settle.toLocaleString("en-US")} gas, an open {GAS.open.toLocaleString("en-US")}, a top-up {GAS.topUp.toLocaleString("en-US")}, a fee or fee
          refund {GAS.fee.toLocaleString("en-US")}, a clock-in or out about {GAS.clockIn.toLocaleString("en-US")}, a close {GAS.close.toLocaleString("en-US")}.
          Each freelancer-month counts a weekly budget (an open, then a top-up each week, each with its fee), one close with its fee refund, and a
          clock-in and out every {SHIFT_HOURS} hours. Paying several tabs in one transaction costs about 40,000 gas per extra tab, so batching lowers
          this. The yield and MON price are assumptions; set the yield to 0 to see the fee alone.
        </p>
      </div>
    </div>
  );
}
