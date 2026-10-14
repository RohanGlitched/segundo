"use client";

import { Fragment, useId, useState } from "react";
import { BATCH_EXTRA, BATCH_TX_GAS, DEFAULTS, GAS, POLICY, SHIFT_HOURS, TABS_PER_BATCH_TX, unitEconomics } from "./economics";
import styles from "./parts.module.css";

type Key =
  | "people"
  | "hours"
  | "rate"
  | "days"
  | "yieldPct"
  | "feePct"
  | "otherUsd"
  | "onScreenPct"
  | "onScreenEvery"
  | "offScreenEvery"
  | "monPrice"
  | "gasGwei";
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
  {
    key: "days",
    label: "Days a budget waits in escrow",
    hint: "On average, from funding to being paid out. A weekly budget spent evenly waits about 3.5 days.",
    min: 0,
    max: 90,
    step: 1,
    suffix: "days",
    group: "work",
  },
  {
    key: "yieldPct",
    label: "Reserve yield shared with Segundo",
    hint: "Our assumption, a year, after the client's share. Agora publishes no partner rate.",
    min: 0,
    max: 6,
    step: 0.25,
    suffix: "%",
    assumption: true,
    group: "work",
  },
  { key: "feePct", label: "Segundo fee, on what clients spend", hint: "1% today. Unspent budget and its fee come back.", min: 0, max: 5, step: 0.1, suffix: "%", group: "work" },
  {
    key: "otherUsd",
    label: "Other variable costs, per freelancer-month",
    hint: "Our assumption: identity checks, sanctions screening, wallet and server costs.",
    min: 0,
    max: 50,
    step: 0.5,
    prefix: "$",
    assumption: true,
    group: "work",
  },
  {
    key: "onScreenEvery",
    label: "Payout while the tab is on screen, every",
    hint: `Mainnet policy: ${POLICY.onScreenS} s. The relayer slows payouts if their gas would pass ${POLICY.gasCap * 100}% of the tab's fee.`,
    min: 1,
    max: 3600,
    step: 1,
    suffix: "s",
    group: "network",
  },
  {
    key: "onScreenPct",
    label: "Share of hours someone has the tab open",
    hint: "Our assumption. The rest of the time nobody is watching the note.",
    min: 0,
    max: 100,
    step: 5,
    suffix: "%",
    assumption: true,
    group: "network",
  },
  {
    key: "offScreenEvery",
    label: "Keeper payout otherwise, every",
    hint: `${POLICY.offScreenS / 60} minutes, in one settleMany, as the testnet keeper runs today. Slowed by the same cap.`,
    min: 10,
    max: 86_400,
    step: 10,
    suffix: "s",
    group: "network",
  },
  {
    key: "monPrice",
    label: "MON price, for mainnet gas",
    hint: "Our conservative assumption: above MON's all-time high of $0.049 and about twice the $0.022 The Block showed in October 2026.",
    min: 0,
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
    suffix: "gwei",
    group: "network",
  },
];

const PRESETS: { name: string; v: Partial<Record<Key, number>> }[] = [
  { name: "One studio", v: { people: 8, hours: 30, rate: 25 } },
  { name: "An agency", v: { people: 150, hours: 35, rate: 20 } },
  { name: "One corridor", v: { people: 10_000, hours: 25, rate: 15 } },
];

const START: Record<Key, number> = {
  people: DEFAULTS.people,
  hours: DEFAULTS.hours,
  rate: DEFAULTS.rate,
  days: DEFAULTS.days,
  yieldPct: DEFAULTS.yieldPct,
  feePct: DEFAULTS.feePct,
  otherUsd: DEFAULTS.otherUsd,
  onScreenPct: DEFAULTS.onScreen * 100,
  onScreenEvery: DEFAULTS.onScreenEvery,
  offScreenEvery: DEFAULTS.offScreenEvery,
  monPrice: DEFAULTS.monPrice,
  gasGwei: DEFAULTS.gasGwei,
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
 * relayer spends on gas to keep everything free for both sides, other variable costs, and what the same hours
 * cost a freelancer to be paid and cash out elsewhere.
 */
export function Calculator({
  marketFee,
  marketLabel,
  convert,
  convertLabel,
  cashOutSpread,
}: {
  marketFee: number;
  marketLabel: string;
  /** The low and high end of a receive-and-convert service's published fees, as fractions. */
  convert: [number, number];
  convertLabel: string;
  /** The cash-out partner's spread on Segundo, assumed (the /cashout default). */
  cashOutSpread: number;
}) {
  const id = useId();
  const [raw, setRaw] = useState<Record<Key, string>>(() => Object.fromEntries(Object.entries(START).map(([k, v]) => [k, String(v)])) as Record<Key, string>);
  const num = (k: Key) => {
    const f = FIELDS.find((x) => x.key === k)!;
    const n = Number(raw[k]);
    return Number.isFinite(n) ? Math.min(f.max, Math.max(f.min, n)) : f.min;
  };

  const [batched, setBatched] = useState(DEFAULTS.batched);
  const e = unitEconomics({
    people: num("people"),
    hours: num("hours"),
    rate: num("rate"),
    days: num("days"),
    yieldPct: num("yieldPct"),
    feePct: num("feePct"),
    onScreen: num("onScreenPct") / 100,
    onScreenEvery: num("onScreenEvery"),
    offScreenEvery: num("offScreenEvery"),
    batched,
    monPrice: num("monPrice"),
    gasGwei: num("gasGwei"),
    otherUsd: num("otherUsd"),
  });
  const { volume, fee, float, gasAll, net, gasTabHour, monTabHour, breakEvenMon } = e;
  const secs = (x: number) => (x < 10 ? x.toFixed(1) : Math.round(x).toLocaleString("en-US"));
  const pct = (x: number) => `${(x * 100).toLocaleString("en-US", { maximumFractionDigits: x < 0.1 ? 1 : 0 })}%`;

  const lostMarket = volume * marketFee;
  const spreadCost = volume * cashOutSpread;

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
              <>
                <p className={styles.calcGroup}>What the relayer pays so neither side ever needs gas</p>
                <div className={styles.calcToggle} role="group" aria-label="How payouts are sent">
                  <button type="button" className="btn small" aria-pressed={batched} onClick={() => setBatched(true)}>
                    Batched payouts
                  </button>
                  <button type="button" className="btn small" aria-pressed={!batched} onClick={() => setBatched(false)}>
                    One payout per transaction
                  </button>
                  <span className={styles.hint}>
                    {batched
                      ? `Every tab due at the same moment is paid in one settleMany: about ${BATCH_EXTRA.toLocaleString("en-US")} gas for each tab after the first, at most ${TABS_PER_BATCH_TX} tabs a transaction.`
                      : `Each payout is its own settle, ${GAS.settle.toLocaleString("en-US")} gas, the way the testnet app pays a tab on screen today.`}
                  </span>
                </div>
              </>
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
            <dt>Pay through Segundo</dt>
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
            <dt>Contribution after gas</dt>
            <dd className="denom">{usd(net)}</dd>
          </div>
          <div className={styles.assumeRow}>
            <dt>Other variable costs (KYC, screening, infra), assumed {cents(num("otherUsd"))} per freelancer-month</dt>
            <dd className={`denom ${styles.cost}`}>−{usd(e.otherAll)}</dd>
          </div>
          <div className={styles.stubSub}>
            <dt>Left after those costs, a month</dt>
            <dd className={`denom ${e.left < 0 ? styles.cost : ""}`}>{usd(e.left)}</dd>
          </div>
          <div className={styles.stubSub}>
            <dt>A year, at this size</dt>
            <dd className="denom">{usd(e.left * 12)}</dd>
          </div>
        </dl>

        <p className={styles.stubHead}>Per freelancer</p>
        <dl className={styles.stub}>
          <div className={styles.stubSub}>
            <dt>Client fee per freelancer-month</dt>
            <dd className="denom">{usd(e.feeFreelancer)}</dd>
          </div>
          <div className={styles.stubSub}>
            <dt>Fee per tab-hour</dt>
            <dd className="denom">{cents(e.feeTabHour)}</dd>
          </div>
          <div className={styles.stubSub}>
            <dt>Relayer gas per tab-hour</dt>
            <dd className="denom">
              {cents(gasTabHour)} <small className={styles.monNote}>{mon(monTabHour)}</small>
            </dd>
          </div>
          <div className={styles.stubSub}>
            <dt>Gas as a share of the fee</dt>
            <dd className={`denom ${e.gasShare > 1 ? styles.cost : ""}`}>{Number.isFinite(e.gasShare) ? pct(e.gasShare) : "—"}</dd>
          </div>
          <div className={styles.stubSub}>
            <dt>Contribution after gas, per freelancer-month</dt>
            <dd className={`denom ${e.netFreelancer < 0 ? styles.cost : ""}`}>{usd(e.netFreelancer)}</dd>
          </div>
        </dl>
        <p className={styles.breakEven}>
          <b>Earned every second; paid out on a schedule.</b> The contract counts pay from timestamps, so nothing is written while the clock runs.{" "}
          {e.noFee ? (
            <>
              With no fee there is nothing to pay gas from, so the relayer sends no on-screen payouts; the keeper still pays every running tab every{" "}
              <b className="denom">{secs(e.offEvery)} s</b>, and the close pays the rest.
            </>
          ) : (
            <>
              Here a tab on screen is paid every <b className="denom">{secs(e.onEvery)} s</b>
              {e.capped ? ` (slowed from ${secs(num("onScreenEvery"))} s)` : ""} and every other running tab every{" "}
              <b className="denom">{secs(e.offEvery)} s</b>
              {e.offCapped ? ` (slowed from ${secs(num("offScreenEvery"))} s)` : ""}: about {Math.round(e.payoutsHour).toLocaleString("en-US")} payouts a
              tab-hour.
              {(e.capped || e.offCapped) &&
                ` The relayer slows payouts so their gas stays under ${POLICY.gasCap * 100}% of a tab's fee; clock-ins, opens, top-ups and the close come on top of that.`}
            </>
          )}
          {batched && e.tabsPerBatch >= 2 && (
            <>
              {" "}
              About {Math.round(e.tabsPerBatch).toLocaleString("en-US")} tabs are on screen at once, paid in {e.batchTxs.toLocaleString("en-US")}{" "}
              {e.batchTxs === 1 ? "settleMany" : "settleMany transactions"} of up to {TABS_PER_BATCH_TX} tabs ({(BATCH_TX_GAS / 1e6).toLocaleString("en-US")} million gas
              each). Payouts at this size use <b className="denom">{pct(e.blockspace)}</b> of Monad&apos;s block gas.
            </>
          )}
        </p>
        <p className={styles.breakEven}>
          <b>Break-even.</b>{" "}
          {Number.isFinite(e.breakEvenSingle) ? (
            <>
              At {cents(num("rate"))} an hour and ${num("monPrice").toLocaleString("en-US")} a MON, the fee pays for a payout every{" "}
              <b className="denom">{secs(e.breakEvenSingle)} s</b> sent one at a time, or every <b className="denom">{secs(e.breakEvenBatched)} s</b>{" "}
              batched.{" "}
            </>
          ) : (
            "With no fee, every payout is a cost. "
          )}
          {Number.isFinite(breakEvenMon) && breakEvenMon > 0 && (
            <>
              At this schedule the fee alone covers gas until MON reaches <b className="denom">{cents(breakEvenMon)}</b>
              {num("monPrice") > 0 && breakEvenMon > num("monPrice")
                ? `, ${(breakEvenMon / num("monPrice")).toLocaleString("en-US", { maximumFractionDigits: 1 })}× the price above`
                : ""}
              .
            </>
          )}
        </p>

        <p className={styles.stubHead}>What the same hours cost a freelancer to be paid and turn into local money, a month</p>
        <dl className={styles.stub}>
          <div>
            <dt>{marketLabel}</dt>
            <dd className={`denom ${styles.loss}`}>{usd(lostMarket)}</dd>
          </div>
          <div>
            <dt>{convertLabel}</dt>
            <dd className={`denom ${styles.loss}`}>
              {usd(volume * convert[0])} to {usd(volume * convert[1])}
            </dd>
          </div>
          <div>
            <dt>On Segundo, to be paid</dt>
            <dd className="denom">$0</dd>
          </div>
          <div className={styles.assumeRow}>
            <dt>Then the cash-out partner&apos;s spread, assumed {(cashOutSpread * 100).toLocaleString("en-US")}% (as on /cashout)</dt>
            <dd className="denom">{usd(spreadCost)}</dd>
          </div>
          <div className={styles.stubTotal}>
            <dt>On Segundo, paid and cashed out</dt>
            <dd className="denom">{usd(spreadCost)}</dd>
          </div>
        </dl>
        <p className={styles.hint}>
          A month is 52 ÷ 12 weeks. Gas per action is the average over Segundo&apos;s relayer receipts on Monad testnet, read October 13, 2026: a payout{" "}
          {GAS.settle.toLocaleString("en-US")} gas, an open {GAS.open.toLocaleString("en-US")}, a top-up {GAS.topUp.toLocaleString("en-US")}, a fee or fee
          refund {GAS.fee.toLocaleString("en-US")}, a clock-in or out about {GAS.clockIn.toLocaleString("en-US")}, a close {GAS.close.toLocaleString("en-US")}.
          Each freelancer-month counts a weekly budget (an open, then a top-up each week, each with its fee), one close with its fee refund, and a
          clock-in and out every {SHIFT_HOURS} hours. A settleMany over two running tabs was estimated at 117,849 gas against 84,609 for one, so
          about {BATCH_EXTRA.toLocaleString("en-US")} per extra tab with the relayer&apos;s 15% margin; batches hold the tabs due at the same moment, with
          hours spread evenly over the week, which is conservative. Block gas is 150 million every 0.305 s, as on Monad testnet during our load test.
          The yield, the MON price, the other costs, the cash-out spread and the share of time on screen are assumptions; set the yield to 0 to see the
          fee alone. Card and bank on-ramp fees are paid by the client on top of the 1%, to the on-ramp partner.
        </p>
      </div>
    </div>
  );
}
