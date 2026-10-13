"use client";

import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import type { History, HistoryItem } from "@/lib/envio";
import { explorerTx } from "@/lib/chain";
import { formatDuration, formatMoney, formatUsd, toUsd, type Currency, type Rates } from "@/lib/money";
import styles from "./statement.module.css";

const ENDPOINT = "https://indexer.dev.hyperindex.xyz/bd7a257/v1/graphql";
const SOURCE = "https://github.com/RohanGlitched/segundo/tree/main/indexer";

/** What /api/envio?address= answers (lib/hyperindex.ts). */
type Indexed = {
  from: "envio-hyperindex";
  lagging: boolean;
  status: { block: number; head: number | null; lagBlocks: number | null; lagSeconds: number | null; events: number };
  person: { earned: string; payoutsReceived: number; clients: number; tabsAsFreelancer: number; shifts: number; secondsWorked: string } | null;
  firstPayout: { timestamp: number; block: number; tx: string } | null;
  lastPayout: { timestamp: number; block: number; tx: string } | null;
  daysPaid: number;
  recent: { block: number; amount: string }[];
};

type Line = { time: number; block: number; hash: string };
type Rec = {
  earned: bigint;
  payouts: number;
  days: number;
  first: Line | null;
  last: Line | null;
  clients: number;
  tabs: number;
  seconds: number;
};

const day = (t: number) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const isoDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const ago = (s: number) => (s < 90 ? `${s} s` : s < 5_400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);

/** The same record, rebuilt from the HyperRPC history the statement already holds. */
function fromHistory(items: HistoryItem[]): Rec {
  const income = items.filter((i) => i.kind === "paid" && i.role === "freelancer" && i.amount);
  const mine = items.filter((i) => i.role === "freelancer");
  // Finished shifts only, as the indexer counts them (a shift still running is added at clock-out).
  const open = new Map<string, number>();
  let seconds = 0;
  for (const i of [...mine].reverse()) {
    if (!i.tab) continue;
    if (i.kind === "clockIn") open.set(i.tab, i.time);
    if (i.kind === "clockOut") {
      const start = open.get(i.tab);
      open.delete(i.tab);
      if (start != null && i.time > start) seconds += i.time - start;
    }
  }
  const line = (i: HistoryItem | undefined) => (i ? { time: i.time, block: i.block, hash: i.hash } : null);
  return {
    earned: income.reduce((s, i) => s + BigInt(i.amount!), 0n),
    payouts: income.length,
    days: new Set(income.map((i) => isoDay(i.time))).size,
    first: line(income.at(-1)),
    last: line(income[0]),
    clients: new Set(mine.map((i) => i.counterparty?.toLowerCase()).filter(Boolean)).size,
    tabs: new Set(mine.map((i) => i.tab).filter(Boolean)).size,
    seconds,
  };
}

function fromIndex(x: Indexed): Rec | null {
  const p = x.person;
  if (!p) return null;
  const line = (l: Indexed["firstPayout"]) => (l ? { time: l.timestamp, block: l.block, hash: l.tx } : null);
  return {
    earned: BigInt(p.earned),
    payouts: p.payoutsReceived,
    days: x.daysPaid,
    first: line(x.firstPayout),
    last: line(x.lastPayout),
    clients: p.clients,
    tabs: p.tabsAsFreelancer,
    seconds: Number(p.secondsWorked),
  };
}

/**
 * Lines the indexer's totals up with the HyperRPC history at the same block: the lower of the two heads. The
 * indexer's newest payouts (block and amount) let its totals be wound back to an earlier block.
 */
function crossCheck(x: Indexed, h: History) {
  if (!x.person) return null;
  const through = Math.min(x.status.block, h.head);
  const after = x.recent.filter((r) => r.block > through);
  // The window of recent payouts must reach back past `through`, or the indexed totals can't be wound back to it.
  if (after.length === x.recent.length && x.recent.length >= 200) return null;
  const idx = { payouts: x.person.payoutsReceived - after.length, units: BigInt(x.person.earned) - after.reduce((s, r) => s + BigInt(r.amount), 0n) };
  const rpcLines = h.items.filter((i) => i.kind === "paid" && i.role === "freelancer" && i.amount && i.block <= through);
  const rpc = { payouts: rpcLines.length, units: rpcLines.reduce((s, i) => s + BigInt(i.amount!), 0n) };
  return { through, idx, rpc, agree: idx.payouts === rpc.payouts && idx.units === rpc.units };
}

export function IndexedRecord({ address, history, cur, rates }: { address: Address; history: History | null; cur: Currency; rates: Rates | null }) {
  const [indexed, setIndexed] = useState<Indexed | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch(`/api/envio?address=${address}`)
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok || body?.from !== "envio-hyperindex") throw new Error(body?.reason ?? "HyperIndex didn't answer");
          if (!stop) {
            setIndexed(body as Indexed);
            setFailed(null);
          }
        })
        .catch((e) => {
          if (stop) return;
          setFailed(e instanceof Error ? e.message : "HyperIndex didn't answer");
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
  }, [address]);

  const fullHistory = history?.source === "envio-hyperrpc" ? history : null;
  // HyperIndex first; HyperRPC when the indexer fails or is more than five minutes behind and HyperRPC has the whole ledger.
  const useIndex = !!indexed && (!indexed.lagging || !fullHistory);
  const record = useMemo(() => (useIndex ? fromIndex(indexed!) : fullHistory ? fromHistory(fullHistory.items) : null), [useIndex, indexed, fullHistory]);
  const check = useMemo(() => (useIndex && fullHistory ? crossCheck(indexed!, fullHistory) : null), [useIndex, indexed, fullHistory]);

  const skeleton = <div className={`skeleton ${styles.recordSkel}`} aria-busy="true" />;
  if (!indexed && !failed) return skeleton;
  if (!useIndex && !fullHistory) {
    if (!history) return skeleton;
    return (
      <p className="notice">
        The all-time record is out of reach right now: Segundo&apos;s Envio HyperIndex indexer didn&apos;t answer ({failed}) and the HyperRPC read is
        still catching up. Reload in a minute.
      </p>
    );
  }

  const money = (units: bigint) => (cur.code === "USD" || !rates ? formatUsd(toUsd(units)) : formatMoney(toUsd(units), cur, rates));
  const s = indexed?.status;

  return (
    <section className={styles.record} aria-labelledby="record">
      <div className={styles.recordHead}>
        <h2 id="record">All time on Segundo</h2>
        <p className={styles.recordSource}>
          {useIndex ? (
            <>
              <b>Indexed by Envio HyperIndex</b> · block <span className="serial">{s!.block.toLocaleString("en-US")}</span>
              {s!.lagSeconds != null && <> · {s!.lagSeconds <= 5 ? "level with Monad" : `${ago(s!.lagSeconds)} behind Monad`}</>}
            </>
          ) : (
            <>
              <b>Read through Envio HyperRPC</b> ·{" "}
              {indexed?.lagging && s?.lagSeconds != null ? `HyperIndex is ${ago(s.lagSeconds)} behind, so this record is rebuilt from raw logs` : "HyperIndex didn't answer, so this record is rebuilt from raw logs"}
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
      </div>

      {!record || record.payouts === 0 ? (
        <p className={styles.empty}>No pay received through Segundo yet.</p>
      ) : (
        <dl className={styles.recordFacts}>
          <div className={styles.recordWide}>
            <dt>Received, all time</dt>
            <dd className="denom">{money(record.earned)}</dd>
            {cur.code !== "USD" && <p className={styles.usd}>{formatUsd(toUsd(record.earned))} AUSD</p>}
          </div>
          <div>
            <dt>Payouts</dt>
            <dd className="denom">{record.payouts.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>Days with pay</dt>
            <dd className="denom">{record.days}</dd>
          </div>
          <div>
            <dt>First payout</dt>
            <dd>
              {record.first && (
                <a href={explorerTx(record.first.hash as `0x${string}`)} target="_blank" rel="noreferrer">
                  {day(record.first.time)}
                </a>
              )}
            </dd>
          </div>
          <div>
            <dt>Latest payout</dt>
            <dd>
              {record.last && (
                <a href={explorerTx(record.last.hash as `0x${string}`)} target="_blank" rel="noreferrer">
                  {day(record.last.time)}
                </a>
              )}
            </dd>
          </div>
          <div>
            <dt>Clients</dt>
            <dd className="denom">{record.clients}</dd>
          </div>
          <div>
            <dt>Tabs</dt>
            <dd className="denom">{record.tabs}</dd>
          </div>
          <div>
            <dt>Finished shifts</dt>
            <dd className="denom">{record.seconds > 0 ? formatDuration(record.seconds) : "—"}</dd>
          </div>
        </dl>
      )}

      {check && (
        <p className={check.agree ? styles.checkOk : styles.checkOff}>
          {check.agree ? (
            <>
              Checked against the HyperRPC read behind the lines below: both count <b>{check.rpc.payouts.toLocaleString("en-US")} payouts</b> and{" "}
              <b>{formatUsd(toUsd(check.rpc.units))}</b> through block <span className="serial">{check.through.toLocaleString("en-US")}</span>.
            </>
          ) : (
            <>
              The two Envio reads differ through block <span className="serial">{check.through.toLocaleString("en-US")}</span>: HyperIndex counts{" "}
              {check.idx.payouts.toLocaleString("en-US")} payouts ({formatUsd(toUsd(check.idx.units))}), HyperRPC {check.rpc.payouts.toLocaleString("en-US")} (
              {formatUsd(toUsd(check.rpc.units))}). The lines below are HyperRPC&apos;s; every one opens on MonadVision.
            </>
          )}
        </p>
      )}
      {useIndex && !fullHistory && history && (
        <p className={styles.checkOff}>HyperRPC is out of reach, so this indexed record is the only all-time view right now; the lines below cover recent minutes.</p>
      )}
    </section>
  );
}
