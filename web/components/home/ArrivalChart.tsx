import styles from "./home.module.css";

/**
 * Money in hand over three weeks for one 35-hour week at $20 an hour, worked Monday to Friday, 9 to 4.
 * Segundo: earned by the second while clocked in, so the line climbs through each working day.
 * Marketplace hourly: billed the next Monday, reviewed, released the following Wednesday
 *   (Upwork's published schedule, about ten days after the week ends), minus a platform fee (not drawn).
 * Bank wire: a typical net-14 invoice sent at the end of the week, then the World Bank's 6.36%
 *   average cost of sending money abroad.
 *
 * Two drawings of the same figure: a wide one with its labels on the lines, and a phone one drawn one unit to a
 * pixel at 360 wide, with real 13-14 px text and the two late payers in a legend under the plot. CSS shows one.
 */
const DAYS = 21;
const TOTAL = 700;
/** The top of the money axis, a little above the week's pay. */
const AXIS = 800;
const MARKET_DAY = 16.5;
const WIRE_DAY = 20;
const WIRE_AMOUNT = TOTAL * (1 - 0.0636);

type Geo = { W: number; H: number; pad: { l: number; r: number; t: number; b: number } };
const WIDE: Geo = { W: 1000, H: 360, pad: { l: 92, r: 46, t: 64, b: 48 } };
const NARROW: Geo = { W: 360, H: 300, pad: { l: 50, r: 12, t: 44, b: 34 } };

function scales({ W, H, pad }: Geo) {
  const x = (day: number) => pad.l + (day / DAYS) * (W - pad.l - pad.r);
  const y = (usd: number) => H - pad.b - (usd / AXIS) * (H - pad.t - pad.b);
  const till = () => {
    let d = `M${x(0)} ${y(0)}`;
    let total = 0;
    for (let day = 0; day < 5; day++) {
      d += ` L${x(day + 9 / 24).toFixed(1)} ${y(total).toFixed(1)}`;
      total += TOTAL / 5;
      d += ` L${x(day + 16 / 24).toFixed(1)} ${y(total).toFixed(1)}`;
    }
    return d + ` L${x(DAYS)} ${y(total)}`;
  };
  const step = (day: number, amount: number) =>
    `M${x(0)} ${y(0)} L${x(day).toFixed(1)} ${y(0)} L${x(day).toFixed(1)} ${y(amount).toFixed(1)} L${x(DAYS)} ${y(amount).toFixed(1)}`;
  return { x, y, till, step };
}

const LABEL =
  "Money received over three weeks for one week of work: Segundo pays during each working day; a marketplace pays about ten days after the week; a bank wire arrives around day 20 with 6.36% lost to fees (the World Bank's average for sending $200).";

function Plot({ geo, narrow }: { geo: Geo; narrow?: boolean }) {
  const { W, H, pad } = geo;
  const { x, y, till, step } = scales(geo);
  const id = narrow ? "hatch-n" : "hatch";
  const area = `${till()} L${x(DAYS)} ${y(0)} Z`;
  const yTicks = narrow ? [0, 400, 800] : [0, 200, 400, 600, 800];
  const xTicks = narrow ? [0, 14, 21] : [0, 7, 14, 21];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`${styles.chart} ${narrow ? styles.chartNarrow : ""}`} role="img" aria-label={LABEL}>
      <defs>
        <pattern id={id} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="7" stroke="var(--serial)" strokeWidth="1" opacity="0.28" />
        </pattern>
      </defs>
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--rule)" strokeWidth="1" />
          <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className={styles.axis}>
            ${v.toLocaleString("en-US")}
          </text>
        </g>
      ))}
      {xTicks.map((d) => (
        <text key={d} x={x(d)} y={H - (narrow ? 10 : 16)} textAnchor={narrow && d === DAYS ? "end" : "middle"} className={styles.axis}>
          {d === 0 ? (narrow ? "Mon" : "Monday") : `Day ${d}`}
        </text>
      ))}
      <rect x={x(0)} y={pad.t} width={x(5) - x(0)} height={H - pad.t - pad.b} fill="var(--ink)" opacity="0.04" />
      <text x={x(2.5)} y={pad.t + 16} textAnchor="middle" className={styles.axis}>
        {narrow ? "Work week" : "The work week"}
      </text>
      <path d={area} fill={`url(#${id})`} />
      <path d={step(WIRE_DAY, WIRE_AMOUNT)} fill="none" stroke="var(--ink-soft)" strokeWidth="2" strokeDasharray="2 5" strokeLinecap="round" />
      <path d={step(MARKET_DAY, TOTAL)} fill="none" stroke="var(--ink)" strokeWidth="2" strokeDasharray="8 6" />
      <path d={till()} fill="none" stroke="var(--serial)" strokeWidth="3" strokeLinejoin="round" />
      <text x={narrow ? x(5.6) : x(5.3)} y={y(TOTAL) - (narrow ? 12 : 14)} className={styles.lineLabel} fill="var(--serial)">
        {narrow ? "Segundo: $700 by Friday" : "Segundo: all $700 by Friday"}
      </text>
      {!narrow && (
        <>
          <text x={x(MARKET_DAY) - 8} y={y(TOTAL * 0.6)} textAnchor="end" className={styles.lineLabel} fill="var(--ink)">
            Marketplace: day 16
          </text>
          <text x={x(WIRE_DAY) - 8} y={y(TOTAL / 4) - 10} textAnchor="end" className={styles.lineLabel} fill="var(--ink-soft)">
            <tspan x={x(WIRE_DAY) - 8}>Wire: day 20,</tspan>
            <tspan x={x(WIRE_DAY) - 8} dy="1.25em">
              less $45 in fees
            </tspan>
          </text>
        </>
      )}
    </svg>
  );
}

export function ArrivalChart() {
  return (
    <figure className={styles.chartFig}>
      <div className={styles.chartWide}>
        <Plot geo={WIDE} />
      </div>
      <div className={styles.chartPhone}>
        <Plot geo={NARROW} narrow />
        <ul className={styles.chartLegend}>
          <li>
            <svg width="30" height="10" viewBox="0 0 30 10" aria-hidden>
              <path d="M1 5h28" stroke="var(--serial)" strokeWidth="3" />
            </svg>
            <span>
              <b>Segundo</b>: paid through each working day, all $700 by Friday
            </span>
          </li>
          <li>
            <svg width="30" height="10" viewBox="0 0 30 10" aria-hidden>
              <path d="M1 5h28" stroke="var(--ink)" strokeWidth="2" strokeDasharray="8 6" />
            </svg>
            <span>
              <b>Marketplace</b>: day 16
            </span>
          </li>
          <li>
            <svg width="30" height="10" viewBox="0 0 30 10" aria-hidden>
              <path d="M2 5h26" stroke="var(--ink-soft)" strokeWidth="2" strokeDasharray="2 5" strokeLinecap="round" />
            </svg>
            <span>
              <b>Bank wire</b>: day 20, less $45 in fees
            </span>
          </li>
        </ul>
      </div>
      <figcaption className={styles.chartCap}>
        One 35-hour week of work at $20 an hour, Monday to Friday. Marketplace timing from Upwork&apos;s hourly schedule; the wire assumes a net-14
        invoice and 6.36%, the World Bank&apos;s average for sending $200 (Q3 2025).
      </figcaption>
    </figure>
  );
}
