"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./home.module.css";

/** The fields of /bench.json read here; every one is optional, since the file may be missing or older. */
export type Bench = {
  runAt?: string;
  txs?: number;
  durationS?: number;
  txPerS?: number;
  senders?: number;
  perBlockMax?: number;
  p50ms?: number;
  p90ms?: number;
  pipelined?: { perBlockMax?: number };
  singleSender?: { txPerS?: number };
  blockTime?: { blocks?: number; avgMs?: number };
  fullestBlockPct?: number;
  succeeded?: number;
};

/** /bench.json: undefined while loading, null when it's missing or unreadable. */
export function useBench() {
  const [bench, setBench] = useState<Bench | null | undefined>(undefined);
  useEffect(() => {
    let stop = false;
    fetch("/bench.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: unknown) => !stop && setBench(d && typeof d === "object" && "txs" in d ? (d as Bench) : null))
      .catch(() => !stop && setBench(null));
    return () => {
      stop = true;
    };
  }, []);
  return bench;
}

const n = (x: number | undefined, digits = 0) => (x == null ? "—" : x.toLocaleString("en-US", { maximumFractionDigits: digits }));
const secs = (ms: number | undefined) => (ms == null ? "—" : `${(ms / 1000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`);

/**
 * "Monad under load": the headline numbers from our benchmark of real payouts on Segundo's contract, read from
 * /bench.json (written by the benchmark run). Without the file it says only where the full write-up lives.
 */
export function UnderLoad({ className, reasons }: { className?: string; reasons?: boolean }) {
  const bench = useBench();

  const day = bench?.runAt ? new Date(bench.runAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;

  return (
    <figure className={`${styles.load} ${className ?? ""}`} aria-busy={bench === undefined}>
      <figcaption className={styles.loadHead}>
        <span>Under load</span>
        <Link href="/network">The whole test, block by block</Link>
      </figcaption>
      {bench ? (
        <>
          <dl className={styles.loadFigs}>
            <div>
              <dt>Payout transactions a second</dt>
              <dd className="denom">{n(bench.txPerS, 1)}</dd>
              <dd className={styles.loadSub}>
                {n(bench.txs)} in {n(bench.durationS, 2)} s from {n(bench.senders)} senders{bench.succeeded != null ? `; ${n(bench.succeeded)} succeeded, ${n(bench.txs! - bench.succeeded)} ran out of gas` : ""}
              </dd>
              {reasons && <dd className={styles.loadWhy}>So one relayer can pay a whole payroll.</dd>}
            </div>
            <div>
              <dt>Most in one block</dt>
              <dd className="denom">{n(bench.perBlockMax)}</dd>
              <dd className={styles.loadSub}>
                {bench.fullestBlockPct != null
                  ? `that block was ${n(bench.fullestBlockPct, 1)}% full, so it had room for many times more`
                  : bench.pipelined?.perBlockMax != null
                    ? `${n(bench.pipelined.perBlockMax)} from a single key`
                    : "payouts in a single block"}
              </dd>
              {reasons && <dd className={styles.loadWhy}>So everyone&apos;s payday fits in a block.</dd>}
            </div>
            <div>
              <dt>Send to block</dt>
              <dd className="denom">{secs(bench.p50ms)}</dd>
              <dd className={styles.loadSub}>median, from sending to the block holding it; {secs(bench.p90ms)} for nine in ten</dd>
              {reasons && <dd className={styles.loadWhy}>So a payout lands while you&apos;re still looking.</dd>}
            </div>
            <div>
              <dt>Block time</dt>
              <dd className="denom">
                {bench.blockTime?.avgMs != null ? `${(bench.blockTime.avgMs / 1000).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} s` : "—"}
              </dd>
              <dd className={styles.loadSub}>average over the last {n(bench.blockTime?.blocks ?? 10_000)} blocks</dd>
              {reasons && <dd className={styles.loadWhy}>So the pay on screen is never more than a moment behind.</dd>}
            </div>
          </dl>
          <p className={styles.loadNote}>
            Real payouts on Segundo&apos;s contract on Monad testnet{day ? `, ${day}` : ""}. Before this test our relayer sent one transaction at a
            time{bench.singleSender?.txPerS != null ? ` (${n(bench.singleSender.txPerS, 1)} a second)` : ""}; it is now a pool of 7 keys, each with many
            transactions in flight, so it sends the way this test did.
          </p>
        </>
      ) : (
        <p className={styles.loadNote}>
          {bench === undefined ? "Reading the benchmark…" : "We pushed hundreds of payouts through Monad at once and wrote down what happened."}{" "}
          <Link href="/network">See Monad under load</Link>.
        </p>
      )}
    </figure>
  );
}
