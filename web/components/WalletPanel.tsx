"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useLive, useChainNow } from "@/lib/live";
import { currency, formatCents, formatMoney, formatUsd, toUsd, type Currency } from "@/lib/money";
import { earnedAt, stateOf, type Profile, type TabView } from "@/lib/tabs";
import { Note } from "./Note";
import styles from "./WalletPanel.module.css";

/** Your wallet, printed as your own note: the balance in your currency, the rosette from every hour you've been paid for. */
export function WalletNote({
  address,
  balance,
  profile,
  paidTabs,
}: {
  address: string;
  balance: bigint | null;
  profile?: Profile;
  paidTabs: TabView[];
}) {
  const { rates } = useLive();
  const now = useChainNow();
  const cur: Currency = currency(profile?.currency || "USD");
  const usd = balance == null ? 0 : toUsd(balance);
  const hours = paidTabs.reduce((h, v) => h + (Number(v.tab.rate) > 0 ? toUsd(earnedAt(v.tab, now)) / toUsd(v.tab.rate) : 0), 0);
  const working = paidTabs.filter((v) => stateOf(v.tab, now) === "working").length;
  const name = profile?.name || "Your wallet";
  return (
    <Note
      id={parseInt(address.slice(-4), 16)}
      usd={usd}
      cur={cur}
      rates={rates}
      payee={{ name, place: profile?.place ?? "" }}
      payer={{ name: "", place: "" }}
      rateUsd={0}
      hours={hours}
      live={working > 0}
      status={working ? `Earning on ${working} ${working === 1 ? "tab" : "tabs"} right now` : balance == null ? "Reading your wallet…" : "Wallet"}
      serialLine={`${address.slice(0, 8)}…${address.slice(-6)}`}
      lines={{
        sub: balance == null ? "Reading balance…" : `${formatUsd(usd, 2)} in AUSD`,
        main: (
          <>
            Held by <b>{name}</b>
            {profile?.place ? `, ${profile.place}` : ""}
          </>
        ),
        extra: hours > 0 ? `${hours < 1 ? Math.round(hours * 60) + " minutes" : hours.toFixed(1) + " hours"} of paid work so far` : "No paid work yet",
      }}
    />
  );
}

/** A statement of where your money is: earned, paid out, and what you have committed as a client. */
export function Ledger({ paid, paying, cur, loading }: { paid: TabView[]; paying: TabView[]; cur: Currency; loading?: boolean }) {
  const { rates } = useLive();
  const now = useChainNow();
  const sum = (xs: TabView[], f: (v: TabView) => bigint) => toUsd(xs.reduce((a, v) => a + f(v), 0n));
  const earned = sum(paid, (v) => earnedAt(v.tab, now));
  const paidOut = sum(paid, (v) => v.tab.paid);
  const spent = sum(paying, (v) => earnedAt(v.tab, now));
  const held = sum(paying.filter((v) => !v.tab.closed), (v) => {
    const left = v.tab.budget - earnedAt(v.tab, now);
    return left > 0n ? left : 0n;
  });
  const money = (usd: number) => (cur.code !== "USD" && rates ? `${formatUsd(usd)} (${formatMoney(usd, cur, rates)})` : formatCents(usd));
  const rows = [
    { k: "Earned as a freelancer", v: money(earned), show: paid.length > 0 },
    { k: "Already in your wallet from tabs", v: money(paidOut), show: paid.length > 0 },
    { k: "Paid to freelancers", v: money(spent), show: paying.length > 0 },
    { k: "Waiting in your open tabs", v: money(held), show: paying.length > 0 },
  ].filter((r) => r.show);
  // While the tabs are read, two blank rows hold the place most accounts need (paying or paid), so the page
  // doesn't jump down when the figures arrive.
  if (loading)
    return (
      <dl className={styles.ledger} aria-busy="true" aria-label="Reading your tabs">
        {[0, 1].map((i) => (
          <div key={i}>
            <dt>
              <span className="skeleton" style={{ display: "inline-block", width: 170, height: "1em", verticalAlign: "middle" }} />
            </dt>
            <dd>
              <span className="skeleton" style={{ display: "inline-block", width: 64, height: "1em", verticalAlign: "middle" }} />
            </dd>
          </div>
        ))}
      </dl>
    );
  if (!rows.length) return null;
  return (
    <dl className={styles.ledger}>
      {rows.map((r) => (
        <div key={r.k}>
          <dt>{r.k}</dt>
          <dd>{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * First visit: the three things to do, each one click away, ticked off as they happen. Drawn only once the balance,
 * tabs and profile are all read (so it doesn't appear and then fold up), and never again once all three are done.
 */
export function GettingStarted({
  address,
  ready,
  hasDollars,
  hasProfile,
  hasTab,
  onFaucet,
  faucetBusy,
}: {
  address: string;
  ready: boolean;
  hasDollars: boolean;
  hasProfile: boolean;
  hasTab: boolean;
  onFaucet: () => void;
  faucetBusy: boolean;
}) {
  const key = `segundo.started.${address.toLowerCase()}`;
  const allDone = ready && hasDollars && hasProfile && hasTab;
  const doneBefore = useMemo(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  }, [key]);
  useEffect(() => {
    if (!allDone) return;
    try {
      localStorage.setItem(key, "1");
    } catch {}
  }, [allDone, key]);
  if (!ready || doneBefore || allDone) return null;
  const steps = [
    {
      done: hasDollars,
      title: "Get test AUSD",
      body: "25 test dollars of Agora's AUSD on Monad testnet. No real money.",
      action: (
        <button className="btn small primary" onClick={onFaucet} disabled={faucetBusy}>
          {faucetBusy ? "Sending…" : "Get 25 test AUSD"}
        </button>
      ),
    },
    {
      done: hasProfile,
      title: "Put your name on your notes",
      body: "Your name, city and the currency you think in. Saved on chain, no gas.",
      action: (
        <a className="btn small" href="#profile">
          Add my name
        </a>
      ),
    },
    {
      done: hasTab,
      title: "Open your first tab",
      body: "Hire a demo freelancer and watch the note print, or invite someone you work with.",
      action: (
        <Link className="btn small" href="/open">
          Open a tab
        </Link>
      ),
    },
  ];
  return (
    <ol className={styles.start} aria-label="Getting started">
      {steps.map((s, i) => (
        <li key={s.title} className={s.done ? styles.done : undefined}>
          <span className={styles.tick} aria-hidden>
            {s.done ? "✓" : i + 1}
          </span>
          <span className={styles.stepText}>
            <b>{s.title}</b>
            <span>{s.done ? "Done." : s.body}</span>
          </span>
          {!s.done && <span className={styles.stepAction}>{s.action}</span>}
        </li>
      ))}
    </ol>
  );
}
