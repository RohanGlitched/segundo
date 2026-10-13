"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { isAddress, type Address } from "viem";
import { InstallApp } from "@/components/InstallApp";
import { PayHistory } from "@/components/PayHistory";
import { ProfileForm } from "@/components/ProfileForm";
import { SealedDetails } from "@/components/SealedDetails";
import { TabRow } from "@/components/TabRow";
import { GettingStarted, Ledger, WalletNote } from "@/components/WalletPanel";
import { ErrorLine, LandedLine, SignInPanel, busyLabel, useAction } from "@/components/ui";
import { useAutoDrip, useMyTabIds, useProfile, useTabs, useDollarBalance } from "@/lib/hooks";
import { useLive, useChainNow } from "@/lib/live";
import { currency, formatMoney, formatUsd, toUnits, toUsd } from "@/lib/money";
import { relay, requestTestDollars, sendDollars } from "@/lib/relay";
import { stateOf, type TabView } from "@/lib/tabs";
import { useWallet } from "@/lib/wallet";
import styles from "./app.module.css";

export default function YourTabs() {
  const wallet = useWallet();
  const me = wallet.address;
  const { ids } = useMyTabIds(me);
  const { views, profiles, refresh, error: readError } = useTabs(ids);
  const { balance, refresh: refreshBalance } = useDollarBalance(me);
  const { rates } = useLive();
  const now = useChainNow();
  const act = useAction();
  const faucet = useAction();
  const drip = useAutoDrip(me, balance, refreshBalance);
  const [sendOpen, setSendOpen] = useState(false);

  // The home-screen shortcut "Send AUSD" lands on /app?send=1. Links to #sealed or #install arrive before the
  // signed-in page has rendered, so scroll once it has.
  const signedIn = wallet.ready && !!me;
  useEffect(() => {
    if (!signedIn) return;
    if (new URLSearchParams(location.search).get("send") === "1") setSendOpen(true);
    const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
    if (target) requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
  }, [signedIn]);

  const mine = useProfile(me);
  const myCur = currency(mine?.currency || "USD");
  const paying = useMemo(() => views?.filter((v) => v.tab.payer.toLowerCase() === me?.toLowerCase()) ?? [], [views, me]);
  const paid = useMemo(() => views?.filter((v) => v.tab.payee.toLowerCase() === me?.toLowerCase()) ?? [], [views, me]);

  if (!wallet.ready) return <main className={`wrap ${styles.page}`} aria-busy="true" />;
  if (!me)
    return (
      <main className={`wrap ${styles.page}`}>
        <SignInPanel title="Sign in to see your tabs">
          <p>Your tabs are the ones you pay into as a client and the ones that pay you as a freelancer.</p>
        </SignInPanel>
        <InstallApp id="install" />
      </main>
    );

  const usd = balance == null ? null : toUsd(balance);
  const lowBalance = balance != null && balance < 5_000_000n;
  const hasStarted = (views?.length ?? 0) > 0 && !!mine?.name;
  const getDollars = () =>
    faucet.run("25 test AUSD arrived", async (sent) => {
      sent();
      const r = await requestTestDollars(me);
      refreshBalance();
      return r;
    });

  const clock = (v: TabView, what: "clockIn" | "clockOut") =>
    act.run(what === "clockIn" ? "Clocked in" : "Clocked out", async (sent) => {
      const p = relay(wallet, what, [v.id]);
      sent();
      const r = await p;
      refresh();
      return r;
    });

  const actionFor = (v: TabView) => {
    const s = stateOf(v.tab, now);
    const iAmPayee = v.tab.payee.toLowerCase() === me.toLowerCase();
    if (iAmPayee && s === "idle")
      return (
        <button className="btn small live" disabled={act.busy} onClick={() => clock(v, "clockIn")}>
          {act.busy && act.which === "Clocked in" ? busyLabel(act.phase, "Clock in") : "Clock in"}
        </button>
      );
    if (iAmPayee && s === "working")
      return (
        <button className="btn small" disabled={act.busy} onClick={() => clock(v, "clockOut")}>
          {act.busy && act.which === "Clocked out" ? busyLabel(act.phase, "Clock out") : "Clock out"}
        </button>
      );
    return (
      <Link className="btn small quiet" href={`/tab/${v.id}`}>
        Open
      </Link>
    );
  };

  return (
    <main className={`wrap ${styles.page}`}>
      <section className={styles.wallet}>
        <div className={styles.walletNote} data-balance={balance?.toString() ?? ""}>
          <WalletNote address={me} balance={balance} profile={mine} paidTabs={paid} />
        </div>
        <div className={styles.walletSide}>
          <h1 className={styles.h1}>{mine?.name ? `${mine.name.split(" ")[0]}'s tabs` : "Your tabs"}</h1>
          <p className={styles.addr}>
            {wallet.kind === "mera"
              ? "Signed in with your passkey. "
              : wallet.kind === "privy"
                ? `Signed in as ${wallet.label}. `
                : "Practice wallet in this browser. "}
            {usd != null && myCur.code !== "USD" && rates ? `${formatUsd(usd)} is about ${formatMoney(usd, myCur, rates)}.` : ""}
          </p>
          {wallet.kind === "mera" && !wallet.unlocked && <PasskeyLock />}
          <div className={styles.walletActions}>
            <Link href="/open" className="btn primary">
              Open a tab
            </Link>
            {((balance != null && balance > 0n) || sendOpen) && (
              <button className="btn" onClick={() => setSendOpen((o) => !o)} aria-expanded={sendOpen}>
                {sendOpen ? "Cancel" : "Send AUSD to someone"}
              </button>
            )}
            {lowBalance && hasStarted && (
              <button className="btn quiet" disabled={faucet.busy} onClick={getDollars}>
                {faucet.busy ? "Sending test AUSD…" : "Get 25 test AUSD"}
              </button>
            )}
          </div>
          <GettingStarted
            hasDollars={(balance ?? 0n) > 0n || (views?.length ?? 0) > 0}
            hasProfile={!!mine?.name}
            hasTab={(views?.length ?? 0) > 0}
            onFaucet={getDollars}
            faucetBusy={faucet.busy || drip.sending}
          />
          <Ledger paid={paid} paying={paying} cur={myCur} />
          <div className={styles.walletNotes}>
            <ErrorLine error={faucet.error} />
            <LandedLine landed={faucet.landed ?? drip.landed} />
          </div>
        </div>
        {sendOpen && <SendForm max={balance ?? 0n} onDone={refreshBalance} onClose={() => setSendOpen(false)} />}
      </section>

      <section className={styles.profile} id="profile">
        <ProfileForm me={me} current={mine} onSaved={refresh} />
      </section>

      <SealedDetails />

      <ErrorLine error={act.error} />
      <LandedLine landed={act.landed} />
      {readError && <p className="notice">{readError}</p>}

      <section className={styles.list}>
        <h2>Paying you</h2>
        {views == null ? (
          <RowSkeletons />
        ) : paid.length ? (
          <ul>
            {paid.map((v) => (
              <TabRow key={String(v.id)} view={v} me={me} profiles={profiles} action={actionFor(v)} />
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>
            No one is paying you yet. When a client sends you an invite link, open it here and the tab appears in this list.
          </p>
        )}
      </section>

      <section className={styles.list}>
        <h2>You&apos;re paying</h2>
        {views == null ? (
          <RowSkeletons />
        ) : paying.length ? (
          <ul>
            {paying.map((v) => (
              <TabRow key={String(v.id)} view={v} me={me} profiles={profiles} action={actionFor(v)} />
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>
            You aren&apos;t paying anyone yet. <Link href="/open">Open a tab</Link> for a freelancer, or try one of the demo freelancers: they
            clock in on their own a few seconds later.
          </p>
        )}
      </section>

      {me && <PayHistory address={me} />}

      <InstallApp id="install" />

      <AppDock
        sendOpen={sendOpen}
        onSend={() => {
          setSendOpen(true);
          requestAnimationFrame(() => document.getElementById("send")?.scrollIntoView({ block: "center" }));
        }}
      />
    </main>
  );
}

/** After 15 idle minutes (or a while in the background) the signing key is dropped; one tap brings it back. */
function PasskeyLock() {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={styles.lock} role="status">
      <p>
        <b>Signing is locked.</b> Your passkey unlocks it until you&rsquo;ve been away for 15 minutes.
      </p>
      <button
        className="btn small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await wallet.unlock?.();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Waiting for your passkey…" : "Unlock"}
      </button>
      {error && <p className={styles.lockError}>{error}</p>}
    </div>
  );
}

/**
 * From the home screen (standalone), the main actions sit in a bar under your thumb, above the home indicator.
 * In a browser tab it's hidden: the same actions are in the page.
 */
function AppDock({ sendOpen, onSend }: { sendOpen: boolean; onSend: () => void }) {
  return (
    <nav className={styles.dock} aria-label="Main actions">
      <button type="button" className={styles.dockItem} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
        <svg viewBox="0 0 24 24" aria-hidden>
          <rect x="3" y="7" width="18" height="11" rx="1.5" />
          <path d="M6 4h12M12 10.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
        </svg>
        Your tabs
      </button>
      <Link href="/open" className={`${styles.dockItem} ${styles.dockMain}`}>
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        Open a tab
      </Link>
      <button type="button" className={styles.dockItem} onClick={onSend} aria-expanded={sendOpen}>
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M4 12h15M13 6l6 6-6 6" />
        </svg>
        Send AUSD
      </button>
    </nav>
  );
}

function RowSkeletons() {
  return (
    <div className={styles.skels} aria-label="Loading tabs">
      {[0, 1].map((i) => (
        <div key={i} className={`skeleton ${styles.rowSkel}`} />
      ))}
    </div>
  );
}

function SendForm({ max, onDone, onClose }: { max: bigint; onDone: () => void; onClose: () => void }) {
  const wallet = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const act = useAction();
  const value = Number(amount) > 0 ? toUnits(Number(amount)) : 0n;
  const problem = !to
    ? "Paste the wallet address you want to send to."
    : !isAddress(to)
      ? "That isn't a wallet address. It starts with 0x and has 42 characters."
      : to.toLowerCase() === wallet.address?.toLowerCase()
        ? "That's your own wallet."
        : value <= 0n
          ? "Enter an amount."
          : value < 10_000n
            ? "The smallest amount is $0.01."
            : value > max
              ? `You have ${formatUsd(toUsd(max))}.`
              : null;
  useEffect(() => {
    if (act.phase === "done") onDone();
  }, [act.phase, onDone]);
  return (
    <form
      className={styles.send}
      id="send"
      onSubmit={(e) => {
        e.preventDefault();
        if (problem) return;
        act.run(`Sent ${formatUsd(Number(amount))}`, async (sent) => {
          const p = sendDollars(wallet, to as Address, value);
          sent();
          const r = await p;
          // A sent form empties itself, so one more click can't send the money twice.
          setTo("");
          setAmount("");
          return r;
        });
      }}
    >
      <div className="field">
        <label htmlFor="to">Send to</label>
        <input id="to" className="input" placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value.trim())} autoComplete="off" />
        <span className="hint">An exchange deposit address or any Monad wallet. You sign; Segundo pays the gas.</span>
      </div>
      <div className="field">
        <label htmlFor="amt">Amount in AUSD</label>
        <input id="amt" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      </div>
      <div className={styles.sendFoot}>
        <button className="btn primary" disabled={!!problem || act.busy}>
          {busyLabel(act.phase, "Send AUSD")}
        </button>
        <button type="button" className="btn quiet" onClick={onClose} disabled={act.busy}>
          {act.phase === "done" ? "Done" : "Cancel"}
        </button>
        {problem && to && <span className="soft">{problem}</span>}
      </div>
      <ErrorLine error={act.error} />
      <LandedLine landed={act.landed} />
    </form>
  );
}
