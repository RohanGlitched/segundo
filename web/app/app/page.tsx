"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AddMoney } from "@/components/AddMoney";
import { InstallApp } from "@/components/InstallApp";
import { PayHistory } from "@/components/PayHistory";
import { ProfileForm } from "@/components/ProfileForm";
import { SealedDetails } from "@/components/SealedDetails";
import { SendSheet, SentLinks } from "@/components/SendSheet";
import { TabRow } from "@/components/TabRow";
import { GettingStarted, Ledger, WalletNote } from "@/components/WalletPanel";
import { ErrorLine, LandedLine, SignInPanel, busyLabel, useAction } from "@/components/ui";
import { dripOnce, useAutoDrip, useMyTabIds, useProfile, useTabs, useDollarBalance } from "@/lib/hooks";
import { useLive, useChainNow } from "@/lib/live";
import { currency, formatMoney, formatUsd, toUsd } from "@/lib/money";
import { relay } from "@/lib/relay";
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
  const [addOpen, setAddOpen] = useState(false);

  // The home-screen shortcut "Send AUSD" and /send's "Send now" land on /app?send=1; /app?add=1 opens "Add money". Links to #sealed or #install arrive before the
  // signed-in page has rendered, so scroll once it has.
  const signedIn = wallet.ready && !!me;
  useEffect(() => {
    if (!signedIn) return;
    const q = new URLSearchParams(location.search);
    if (q.get("send") === "1") setSendOpen(true);
    else if (q.get("add") === "1") setAddOpen(true);
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
        <SignInPanel title="Sign in to see your tabs" level={1}>
          <p>Your tabs are the ones you pay into as a client and the ones that pay you as a freelancer.</p>
        </SignInPanel>
        <InstallApp id="install" />
      </main>
    );

  const usd = balance == null ? null : toUsd(balance);
  const lowBalance = balance != null && balance < 5_000_000n;
  const hasStarted = (views?.length ?? 0) > 0 && !!mine?.name;
  // One faucet request at a time: not before the balance is known (a new wallet gets its first 25 by itself), and not
  // while the automatic one is on its way.
  const faucetBusy = faucet.busy || drip.sending || balance == null;
  const getDollars = () =>
    faucet.run("25 test AUSD arrived", async (sent) => {
      sent();
      const r = await dripOnce(me);
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
            <button className="btn" onClick={() => setSendOpen(true)} aria-haspopup="dialog" aria-expanded={sendOpen}>
              <svg className={styles.sendIcon} viewBox="0 0 24 24" aria-hidden>
                <path d="M4 12h15M13 6l6 6-6 6" />
              </svg>
              Send AUSD
            </button>
            <button className="btn" onClick={() => setAddOpen(true)} aria-haspopup="dialog" aria-expanded={addOpen}>
              <svg className={styles.sendIcon} viewBox="0 0 24 24" aria-hidden>
                <path d="M12 4v15M6 13l6 6 6-6" />
              </svg>
              Add money
            </button>
            {lowBalance && hasStarted && (
              <button className="btn quiet" disabled={faucetBusy} onClick={getDollars}>
                {faucet.busy ? "Sending test AUSD…" : "Get 25 test AUSD"}
              </button>
            )}
          </div>
          <p className={styles.more}>
            <Link href="/send">Send dollars abroad</Link>
            <span aria-hidden> · </span>
            <Link href="/request">Ask a client for a tab</Link>
            <span aria-hidden> · </span>
            <Link href="/cashout">Cash out to local money</Link>
          </p>
          <GettingStarted
            address={me}
            ready={balance != null && views != null && mine !== undefined}
            hasDollars={(balance ?? 0n) > 0n || (views?.length ?? 0) > 0}
            hasProfile={!!mine?.name}
            hasTab={(views?.length ?? 0) > 0}
            onFaucet={getDollars}
            faucetBusy={faucetBusy}
          />
          <Ledger paid={paid} paying={paying} cur={myCur} loading={views == null} />
          <div className={styles.walletNotes}>
            <ErrorLine error={faucet.error} />
            <LandedLine landed={faucet.landed ?? drip.landed} />
          </div>
        </div>
      </section>

      <SendSheet
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        balance={balance}
        fromName={mine?.name ?? ""}
        onMoved={refreshBalance}
        onFaucet={getDollars}
        faucetBusy={faucetBusy}
      />
      <AddMoney
        open={addOpen}
        onClose={() => setAddOpen(false)}
        address={me}
        balance={balance}
        onFaucet={getDollars}
        faucetBusy={faucetBusy}
        faucetError={faucet.error}
      />
      <SentLinks me={me} onMoved={refreshBalance} />

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

      <AppDock sendOpen={sendOpen} onSend={() => setSendOpen(true)} />
    </main>
  );
}

/** The signing key lives only in memory: dropped on reload, after 15 idle minutes or a while in the background; one tap brings it back. */
function PasskeyLock() {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={styles.lock} role="status">
      <p>
        <b>Signing is locked.</b> Your passkey unlocks it until you&rsquo;ve been away for 15 minutes, and whenever you reload or close the
        page.
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
 * On a phone (the home-screen app or a phone-width browser), the main actions sit in a bar under your thumb, above
 * the home indicator. On wider screens it's hidden: the same actions are in the page.
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
      <button type="button" className={styles.dockItem} onClick={onSend} aria-haspopup="dialog" aria-expanded={sendOpen}>
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
