"use client";

import Link from "next/link";
import { useLive, useChainNow } from "@/lib/live";
import { currency, formatMoney, formatUsd, toUsd, type Currency } from "@/lib/money";
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
export function Ledger({ paid, paying, cur }: { paid: TabView[]; paying: TabView[]; cur: Currency }) {
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
  const money = (usd: number) => (cur.code !== "USD" && rates ? `${formatUsd(usd)} (${formatMoney(usd, cur, rates)})` : formatUsd(usd, usd > 0 && usd < 1 ? 4 : 2));
  const rows = [
    { k: "Earned as a freelancer", v: money(earned), show: paid.length > 0 },
    { k: "Already in your wallet from tabs", v: money(paidOut), show: paid.length > 0 },
    { k: "Paid to freelancers", v: money(spent), show: paying.length > 0 },
    { k: "Waiting in your open tabs", v: money(held), show: paying.length > 0 },
  ].filter((r) => r.show);
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

/** First visit: the three things to do, each one click away, ticked off as they happen. */
export function GettingStarted({
  hasDollars,
  hasProfile,
  hasTab,
  onFaucet,
  faucetBusy,
}: {
  hasDollars: boolean;
  hasProfile: boolean;
  hasTab: boolean;
  onFaucet: () => void;
  faucetBusy: boolean;
}) {
  if (hasDollars && hasProfile && hasTab) return null;
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
