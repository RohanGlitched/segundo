"use client";

import { TREASURY, explorerAddress } from "@/lib/chain";
import { DailyBars } from "./DailyBars";
import { count, money, usdOf, useStats, type Stats } from "./stats";
import styles from "./parts.module.css";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const sourceName = (s: string) => (s.includes("hyperrpc") ? "Envio HyperRPC" : s.includes("hypersync") ? "Envio HyperSync" : s.startsWith("envio") ? "Envio" : "Monad's public RPC");

function updated(s: Stats) {
  const d = new Date(typeof s.updatedAt === "number" && s.updatedAt < 1e12 ? s.updatedAt * 1000 : s.updatedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

/** The treasury and the money around it, read from Monad testnet through /api/stats. */
export function LiveRevenue() {
  const stats = useStats();
  const treasury = stats?.treasury || TREASURY;
  const treasuryLink = (
    <a href={explorerAddress(treasury)} target="_blank" rel="noreferrer" className="serial">
      {short(treasury)}
    </a>
  );

  if (stats === undefined) {
    return (
      <div className={styles.ledger} aria-busy="true">
        <div className={styles.ledgerMain}>
          <div className={styles.treasury}>
            <span className={styles.label}>Fees collected in the Segundo treasury</span>
            <span className={`skeleton ${styles.skelBig}`} />
            <span className={`skeleton ${styles.skelLine}`} />
          </div>
          <div className={`skeleton ${styles.skelGrid}`} />
        </div>
        <p className={styles.honest}>Reading Monad testnet…</p>
      </div>
    );
  }

  if (stats === null) {
    return (
      <div className={styles.ledger}>
        <div className={styles.ledgerMain}>
          <div className={styles.treasury}>
            <span className={styles.label}>Fees collected in the Segundo treasury</span>
            <p className={styles.unavailable}>
              The live figures aren&apos;t answering right now. Every fee is a public transfer into the treasury, so you can count them yourself on
              MonadVision: {treasuryLink}.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const fees = usdOf(stats.fees.total);
  const week = usdOf(stats.fees.last7d);
  const paid = usdOf(stats.paid.total);
  const daily = [...stats.daily].sort((a, b) => a.day.localeCompare(b.day)).slice(-30);
  const at = updated(stats);
  const figures: [string, string][] = [
    ["Paid to freelancers", money(paid)],
    ["Payouts", count(stats.paid.payouts)],
    ["Tabs opened", count(stats.paid.tabs)],
    ["Freelancers paid", count(stats.paid.freelancers)],
    ["Clients paying", count(stats.paid.clients)],
    ["Pay lands on a running tab every", stats.settle.medianMs == null ? "—" : `${(stats.settle.medianMs / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} s`],
  ];

  return (
    <div className={styles.ledger}>
      <div className={styles.ledgerTop}>
        <span className={styles.liveTag}>
          <i aria-hidden /> Live from Monad testnet
        </span>
        <span className={styles.soft}>
          {at ? `Updated ${at}` : "Updated a moment ago"} · read with {sourceName(stats.source)}
        </span>
      </div>
      <div className={styles.ledgerMain}>
        <div className={styles.treasury}>
          <span className={styles.label}>Fees collected in the Segundo treasury</span>
          <strong className={`denom ${styles.big}`}>{money(fees)}</strong>
          <span className={styles.soft}>
            {stats.fees.count === 0
              ? "No fees yet: the first lands when the next client opens or tops up a tab."
              : `from ${count(stats.fees.count)} ${stats.fees.count === 1 ? "fee" : "fees"}, ${money(week)} of it in the last 7 days`}
          </span>
          <span className={styles.treasuryAddr}>Treasury {treasuryLink} on MonadVision</span>
        </div>
        <dl className={styles.figures}>
          {figures.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="denom">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className={styles.charts}>
        <DailyBars title="Fees per day" tone="serial" points={daily.map((d) => ({ day: d.day, value: usdOf(d.fees) }))} />
        <DailyBars title="Paid to freelancers per day" tone="ink" points={daily.map((d) => ({ day: d.day, value: usdOf(d.paid) }))} />
      </div>
      <p className={styles.honest}>
        Testnet, including our demo studios: three bot studios pay five bot freelancers on their local working hours, alongside everyone who
        tries the app. Test AUSD has no value. Fees started when the 1% went live, so paid-out money before that carries no fee.
        {stats.source === "rpc" && " While the indexer is unavailable, fee and payout counts cover recent blocks only."}
      </p>
    </div>
  );
}
