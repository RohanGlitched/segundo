"use client";

import { useEffect, useState } from "react";
import { formatDuration, formatUsd, toUsd } from "@/lib/money";
import styles from "./lookup.module.css";

const ENDPOINT = "https://indexer.dev.hyperindex.xyz/bd7a257/v1/graphql";
const SOURCE = "https://github.com/RohanGlitched/segundo/tree/main/indexer";

type Day = { day: string; paid: string; payouts: number; tabs: number; seconds: number | null };
/** What /api/envio answers (lib/hyperindex.ts, or the HyperRPC ledger in lib/envio.ts as a fallback). */
type Reply = {
  from: "envio-hyperindex" | "envio-hyperrpc";
  lagging?: boolean;
  reason?: string | null;
  asOf?: string;
  status: { block: number; lagSeconds: number | null; events: number } | null;
  totals: { paid: string; payouts: number; tabs: number; seconds: number | null; keeperRuns: number | null; rateReports: number | null };
  daily: Day[];
  bench: { tabs: number; payouts: number };
};

const label = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const ago = (s: number) => (s < 90 ? `${s} s` : s < 5_400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);
const usd = (units: string | bigint) => {
  const v = toUsd(BigInt(units));
  return formatUsd(v, v >= 1000 ? 0 : 2);
};

/** Network-wide pay by day, from Segundo's Envio HyperIndex indexer (DailyStat and Totals), HyperRPC as a fallback. */
export function NetworkLedger() {
  const [data, setData] = useState<Reply | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/envio")
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok || !body?.from) throw new Error(body?.reason ?? "no answer");
          if (!stop) {
            setData(body as Reply);
            setFailed(false);
          }
        })
        .catch(() => {
          if (stop) return;
          setFailed(true);
          // One quick second try before the minute's poll: a cold instance can miss the 3-second budget once.
          if (!retried) {
            retried = true;
            retry = setTimeout(load, 4_000);
          }
        });
    let retried = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    load();
    const t = setInterval(load, 60_000);
    return () => {
      stop = true;
      clearInterval(t);
      clearTimeout(retry);
    };
  }, []);

  if (!data) {
    if (failed)
      return (
        <p className="notice">
          Neither of Segundo&apos;s Envio reads (the HyperIndex indexer or HyperRPC) answered just now, so the network figures will show on the next
          try.
        </p>
      );
    return <div className={`skeleton ${styles.ledgerSkel}`} aria-busy="true" />;
  }

  // From the first day with any activity: the contract is younger than the window.
  const start = data.daily.findIndex((d) => d.payouts > 0 || d.tabs > 0);
  const days = start > 0 ? data.daily.slice(start) : data.daily;
  const max = days.reduce((m, d) => (BigInt(d.paid) > m ? BigInt(d.paid) : m), 0n);
  const peak = days.find((d) => BigInt(d.paid) === max);
  const sum = days.reduce((s, d) => s + BigInt(d.paid), 0n);
  const pays = days.reduce((s, d) => s + d.payouts, 0);
  const indexed = data.from === "envio-hyperindex";
  const s = data.status;

  return (
    <div className={styles.ledger}>
      <dl className={styles.ledgerFacts}>
        <div>
          <dt>Paid to freelancers, all time</dt>
          <dd className="denom">{usd(data.totals.paid)}</dd>
        </div>
        <div>
          <dt>Payouts</dt>
          <dd className="denom">{data.totals.payouts.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>Tabs opened</dt>
          <dd className="denom">{data.totals.tabs.toLocaleString("en-US")}</dd>
        </div>
        {data.totals.seconds != null && (
          <div>
            <dt>Finished shifts</dt>
            <dd className="denom">{formatDuration(data.totals.seconds).replace(/ \d+ min$/, "")}</dd>
          </div>
        )}
        {data.totals.keeperRuns != null && (
          <div>
            <dt>Chainlink CRE keeper runs</dt>
            <dd className="denom">{data.totals.keeperRuns}</dd>
          </div>
        )}
      </dl>

      <figure className={styles.ledgerChart}>
        <ol className={styles.ledgerBars} style={{ ["--n" as string]: days.length }}>
          {days.map((d, i) => {
            const v = BigInt(d.paid);
            const pct = max > 0n ? (Number(v) / Number(max)) * 100 : 0;
            const text = `${label(d.day)}: ${usd(d.paid)} in ${d.payouts} payout${d.payouts === 1 ? "" : "s"}${d.tabs ? `, ${d.tabs} tab${d.tabs === 1 ? "" : "s"} opened` : ""}`;
            return (
              <li key={d.day} title={text}>
                <span className="visually-hidden">{text}</span>
                <span className={styles.ledgerCol} aria-hidden>
                  <span className={styles.ledgerBar} style={v > 0n ? { height: `${Math.max(pct, 2)}%` } : { height: 0, borderTopWidth: 0 }}>
                    {d === peak && max > 0n && <span className={`${styles.ledgerPeak} ${i > days.length / 2 ? styles.ledgerPeakEnd : ""}`}>{usd(d.paid)}</span>}
                  </span>
                </span>
                <span className={styles.ledgerCount} aria-hidden>
                  {d.payouts || ""}
                </span>
                <span className={styles.ledgerTick} aria-hidden>
                  {i === days.length - 1 || (i % 3 === 0 && days.length - 1 - i >= 2) ? label(d.day) : ""}
                </span>
              </li>
            );
          })}
        </ol>
        <figcaption className="soft">
          AUSD paid to freelancers each UTC day{start > 0 ? " since the first payout" : ` for the last ${days.length} days`}, with the number of payouts under each bar: {usd(sum)} in{" "}
          {pays.toLocaleString("en-US")} payouts.
        </figcaption>
      </figure>

      <p className={styles.ledgerSource}>
        {indexed ? (
          <>
            <b>Indexed by Envio HyperIndex</b>
            {s && (
              <>
                {" "}
                · block <span className="serial">{s.block.toLocaleString("en-US")}</span>
                {s.lagSeconds != null && <> · {s.lagSeconds <= 5 ? "level with Monad" : `${ago(s.lagSeconds)} behind Monad`}</>}
              </>
            )}
            {data.lagging && data.reason && <> · {data.reason}; HyperRPC didn&apos;t answer either</>}
          </>
        ) : (
          <>
            <b>Read through Envio HyperRPC</b> · {data.reason ?? "HyperIndex didn't answer"}, so these figures are rebuilt from raw logs
          </>
        )}{" "}
        ·{" "}
        <a href={ENDPOINT} target="_blank" rel="noreferrer">
          GraphQL
        </a>{" "}
        ·{" "}
        <a href={SOURCE} target="_blank" rel="noreferrer">
          indexer source
        </a>
      </p>
      <p className={styles.note}>
        Every tab on the contract counts, our demo studios and freelancers included, as in every network figure on the site. The Oct 13 load
        benchmark ({data.bench.tabs} tabs, {data.bench.payouts.toLocaleString("en-US")} payouts) is left out, so these line up with the same events read through HyperRPC
        (<a href="/api/stats">/api/stats</a>).
      </p>
    </div>
  );
}
