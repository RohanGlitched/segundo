"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import type { History, HistoryItem } from "@/lib/envio";
import { explorerTx } from "@/lib/chain";
import { useProfile } from "@/lib/hooks";
import { useChainNow, useLive } from "@/lib/live";
import { ago, currency, formatMoney, formatUsd, toUsd } from "@/lib/money";
import { readProfiles, shortAddress, type Profile } from "@/lib/tabs";
import styles from "./PayHistory.module.css";

/**
 * One address's history from /api/history (read from Monad through Envio HyperRPC), refreshed every 30 seconds.
 * `limit` keeps only the newest lines; totals always cover everything.
 */
export function useHistoryFeed(address?: Address | null, limit?: number) {
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!address) return setData(null);
    let stop = false;
    const load = () =>
      fetch(`/api/history?address=${address}${limit ? `&limit=${limit}` : ""}`)
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok) throw new Error(body?.error ?? "Monad didn't answer.");
          if (!stop) {
            setData(body as History);
            setError(null);
          }
        })
        .catch((e) => !stop && setError(e instanceof Error ? e.message : "Monad didn't answer."));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [address, limit]);
  return { data, error };
}

/** Names for the people on the other side of each line (one multicall). */
export function useNames(addrs: string[]) {
  const [names, setNames] = useState<Record<string, Profile>>({});
  const key = [...new Set(addrs.map((a) => a.toLowerCase()))].sort().join(",");
  useEffect(() => {
    if (!key) return;
    readProfiles(key.split(",").slice(0, 60) as Address[])
      .then((p) => setNames((old) => ({ ...old, ...p })))
      .catch(() => {});
  }, [key]);
  return names;
}

export const nameOf = (names: Record<string, Profile>, a: string | null) => (a ? names[a.toLowerCase()]?.name || shortAddress(a) : "someone");

/**
 * A compact pay history for /app and the tab page: the newest lines for one address (optionally one tab), each with
 * its block linked to MonadVision, and a link to the full income statement.
 */
export function PayHistory({ address, tab, limit = 8, title = "Pay history" }: { address: Address; tab?: bigint | string; limit?: number; title?: string }) {
  // A single tab's lines are filtered here, so read the whole history in that case.
  const { data, error } = useHistoryFeed(address, tab == null ? limit : undefined);
  const now = useChainNow();
  const { rates } = useLive();
  const mine = useProfile(address);
  const cur = currency(mine?.currency || "USD");
  const lines = useMemo(() => {
    const all = data?.items.filter((i) => i.kind !== "clockIn" && i.kind !== "clockOut") ?? [];
    return (tab == null ? all : all.filter((i) => i.tab === String(tab))).slice(0, limit);
  }, [data, tab, limit]);
  const names = useNames(lines.map((l) => l.counterparty).filter((a): a is Address => !!a));
  const money = (units: string) => {
    const usd = toUsd(BigInt(units));
    return cur.code === "USD" || !rates ? formatUsd(usd) : formatMoney(usd, cur, rates);
  };

  return (
    <section className={styles.box} aria-labelledby="payhistory">
      <div className={styles.head}>
        <h2 id="payhistory">{title}</h2>
        {data && (
          <Link href={`/proof/${address}`} className={styles.proof}>
            Income statement
          </Link>
        )}
      </div>
      {!data && !error ? (
        <div className={`skeleton ${styles.skel}`} />
      ) : !data ? (
        <p className="soft">{error}</p>
      ) : lines.length === 0 ? (
        <p className="soft">Nothing yet. Payouts show up here a moment after they land.</p>
      ) : (
        <ol className={styles.lines}>
          {lines.map((l, i) => (
            <li key={`${l.hash}-${l.kind}-${i}`}>
              <span className={styles.when}>{l.time ? ago(now - l.time) : "—"}</span>
              <span className={styles.what}>
                <span className={l.kind === "paid" && l.role === "freelancer" ? styles.in : undefined}>{describe(l, nameOf(names, l.counterparty), money)}</span>
                {l.tab && tab == null && (
                  <Link href={`/tab/${l.tab}`} className={styles.tab}>
                    tab <span className="serial">№ {l.tab.padStart(4, "0")}</span>
                  </Link>
                )}
              </span>
              <a className="serial" href={explorerTx(l.hash)} target="_blank" rel="noreferrer">
                block {l.block.toLocaleString("en-US")}
              </a>
            </li>
          ))}
        </ol>
      )}
      {data && (
        <p className={styles.source}>
          {data.source === "envio-hyperrpc"
            ? "Read from Monad through Envio HyperRPC."
            : "Envio HyperRPC is out of reach, so only the last few minutes are listed, read from Monad's public RPC."}
        </p>
      )}
    </section>
  );
}

export function describe(l: HistoryItem, other: string, money: (units: string) => string): string {
  const amt = l.amount ?? "0";
  const freelancer = l.role === "freelancer";
  switch (l.kind) {
    case "paid":
      return freelancer ? `${money(amt)} from ${other}` : `Paid ${other} ${formatUsd(toUsd(BigInt(amt)))}`;
    case "opened":
      return freelancer ? `${other} opened a tab for you (${formatUsd(toUsd(BigInt(amt)))})` : `Opened a tab for ${other === "someone" ? "an invite" : other} with ${formatUsd(toUsd(BigInt(amt)))}`;
    case "topup":
      return freelancer ? `${other} added ${formatUsd(toUsd(BigInt(amt)))}` : `Added ${formatUsd(toUsd(BigInt(amt)))}`;
    case "closed":
      return `Tab closed, ${formatUsd(toUsd(BigInt(amt)))} paid in all`;
    case "refund":
      return `${formatUsd(toUsd(BigInt(amt)))} back to you`;
    case "fee":
      return `Segundo fee, ${formatUsd(toUsd(BigInt(amt)), 2)}`;
    case "clockIn":
      return "Clocked in";
    case "clockOut":
      return "Clock stopped";
  }
}
