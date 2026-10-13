import styles from "./home.module.css";

/**
 * Money in hand over three weeks for one 40-hour week at $30 an hour, worked Monday to Friday.
 * Segundo: earned by the second while clocked in, so the line climbs through each working day.
 * Marketplace hourly: billed the next Monday, reviewed, released the following Wednesday
 *   (Upwork's published schedule, about ten days after the week ends), minus a platform fee (not drawn).
 * Bank wire: a typical net-14 invoice sent at the end of the week, then the World Bank's 6.36%
 *   average cost of sending money abroad.
 */
const W = 1000;
const H = 360;
const PAD = { l: 92, r: 46, t: 64, b: 48 };
const DAYS = 21;
const TOTAL = 1200;
const x = (day: number) => PAD.l + (day / DAYS) * (W - PAD.l - PAD.r);
const y = (usd: number) => H - PAD.b - (usd / TOTAL) * (H - PAD.t - PAD.b);

function tillPath() {
  let d = `M${x(0)} ${y(0)}`;
  let total = 0;
  for (let day = 0; day < 5; day++) {
    d += ` L${x(day + 9 / 24).toFixed(1)} ${y(total).toFixed(1)}`;
    total += 240;
    d += ` L${x(day + 17 / 24).toFixed(1)} ${y(total).toFixed(1)}`;
  }
  return d + ` L${x(DAYS)} ${y(total)}`;
}
const step = (day: number, amount: number) => `M${x(0)} ${y(0)} L${x(day)} ${y(0)} L${x(day)} ${y(amount)} L${x(DAYS)} ${y(amount)}`;
const MARKET_DAY = 16.5;
const WIRE_DAY = 20;
const WIRE_AMOUNT = TOTAL * (1 - 0.0636);

export function ArrivalChart() {
  const area = `${tillPath()} L${x(DAYS)} ${y(0)} Z`;
  return (
    <figure className={styles.chartFig}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.chart}
        role="img"
        aria-label="Money received over three weeks for one week of work: Segundo pays during each working day; a marketplace pays about ten days after the week; a bank wire arrives around day 20 with 6.36% lost to fees."
      >
        <defs>
          <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--serial)" strokeWidth="1" opacity="0.28" />
          </pattern>
        </defs>
        {[0, 300, 600, 900, 1200].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--rule)" strokeWidth="1" />
            <text x={PAD.l - 10} y={y(v) + 4} textAnchor="end" className={styles.axis}>
              ${v.toLocaleString("en-US")}
            </text>
          </g>
        ))}
        {[0, 7, 14, 21].map((d) => (
          <text key={d} x={x(d)} y={H - 16} textAnchor="middle" className={styles.axis}>
            {d === 0 ? "Monday" : `Day ${d}`}
          </text>
        ))}
        <rect x={x(0)} y={PAD.t} width={x(5) - x(0)} height={H - PAD.t - PAD.b} fill="var(--ink)" opacity="0.04" />
        <text x={x(2.5)} y={PAD.t + 16} textAnchor="middle" className={styles.axis}>
          The work week
        </text>
        <path d={area} fill="url(#hatch)" />
        <path d={step(WIRE_DAY, WIRE_AMOUNT)} fill="none" stroke="var(--ink-soft)" strokeWidth="2" strokeDasharray="2 5" strokeLinecap="round" />
        <path d={step(MARKET_DAY, TOTAL)} fill="none" stroke="var(--ink)" strokeWidth="2" strokeDasharray="8 6" />
        <path d={tillPath()} fill="none" stroke="var(--serial)" strokeWidth="3" strokeLinejoin="round" />
        <text x={x(5.3)} y={y(TOTAL) - 14} className={styles.lineLabel} fill="var(--serial)">
          Segundo: all $1,200 by Friday
        </text>
        <text x={x(MARKET_DAY) - 8} y={y(TOTAL * 0.6)} textAnchor="end" className={styles.lineLabel} fill="var(--ink)">
          Marketplace: day 16
        </text>
        <text x={x(WIRE_DAY) - 8} y={y(TOTAL / 4) - 10} textAnchor="end" className={styles.lineLabel} fill="var(--ink-soft)">
          <tspan x={x(WIRE_DAY) - 8}>Wire: day 20,</tspan>
          <tspan x={x(WIRE_DAY) - 8} dy="1.25em">
            less $76 in fees
          </tspan>
        </text>
      </svg>
      <figcaption className={styles.chartCap}>
        One week of work at $30 an hour, Monday to Friday. Marketplace timing from Upwork&apos;s hourly schedule; the wire assumes a net-14 invoice
        and the World Bank&apos;s 6.36% average (Q3 2025) cost of sending money abroad.
      </figcaption>
    </figure>
  );
}
