"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { InviteBox } from "@/components/InviteBox";
import { TabNote, personOf } from "@/components/TabNote";
import { TimeCard } from "@/components/TimeCard";
import { ErrorLine, LandedLine, busyLabel, useAction } from "@/components/ui";
import { explorerTx } from "@/lib/chain";
import { useHistory, useTabs, useDollarBalance, type StubLine } from "@/lib/hooks";
import { inviteLink, loadInvite } from "@/lib/invite";
import { useChainNow, useLive } from "@/lib/live";
import { ago, currency, formatDuration, formatMoney, formatUsd, toUnits, toUsd } from "@/lib/money";
import { relay, settleNow, signPermit, type Landed } from "@/lib/relay";
import { DEMO_FREELANCERS } from "@/lib/demo";
import { earnedAt, isZero, stateOf } from "@/lib/tabs";
import { useWallet } from "@/lib/wallet";
import styles from "./tab.module.css";

/**
 * How often the page pays out while someone watches a running tab. Every payout is a Monad
 * transaction the relayer pays gas for, so the pace eases the longer the page stays open.
 */
function payEvery(secondsOpen: number) {
  if (secondsOpen < 120) return 6_000;
  if (secondsOpen < 600) return 20_000;
  return 60_000;
}
const PACE_WORDS: Record<number, string> = {
  6_000: "Paying out every few seconds while this page is open.",
  20_000: "Paying out every 20 seconds while this page stays open.",
  60_000: "Paying out once a minute while this page stays open. Cash out any time for the rest.",
};

export default function TabPage() {
  const params = useParams<{ id: string }>();
  const id = useMemo(() => (/^\d+$/.test(params.id) ? BigInt(params.id) : null), [params.id]);
  const ids = useMemo(() => (id ? [id] : null), [id]);
  const { views, profiles, refresh, error } = useTabs(ids, 2000);
  const view = views?.[0];
  const wallet = useWallet();
  const me = wallet.address?.toLowerCase();
  const now = useChainNow();
  const { rates } = useLive();
  const act = useAction();
  const { lines, more } = useHistory(id, view?.tab.lastBlock, 30);
  const [copied, setCopied] = useState(false);
  const [payouts, setPayouts] = useState<(Landed & { amount: number })[]>([]);
  const [topUp, setTopUp] = useState("");
  const [showTopUp, setShowTopUp] = useState(false);
  const { balance } = useDollarBalance(wallet.address);
  const [invite, setInvite] = useState<string | null>(null);
  const [pace, setPace] = useState(6_000);
  const [confirmClose, setConfirmClose] = useState(false);

  const t = view?.tab;
  const state = t ? stateOf(t, now) : null;
  const exists = t && !isZero(t.payer);

  useEffect(() => {
    if (!id) return;
    const k = loadInvite(id);
    setInvite(k ? inviteLink(id, k) : null);
  }, [id]);

  // While someone watches a running tab, pay out every few seconds so the wallet balance moves live.
  const watching = useRef(true);
  useEffect(() => {
    const onVis = () => (watching.current = document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  useEffect(() => {
    if (!id || state !== "working") return;
    const since = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const every = payEvery((Date.now() - since) / 1000);
      setPace(every);
      if (watching.current) {
        try {
          const r = await settleNow(id);
          setPayouts((p) => [{ ...r, amount: toUsd(r.amount) }, ...p].slice(0, 4));
          refresh();
        } catch {}
      }
      timer = setTimeout(tick, every);
    };
    timer = setTimeout(tick, 1500);
    return () => clearTimeout(timer);
  }, [id, state, refresh]);

  // When the clock stops (clock-out, pause, or the budget running out), the last seconds of pay
  // are still owed. Send them once, so nobody is left waiting for a payout that never comes.
  const settledFor = useRef("");
  const stopKey = (() => {
    if (!view || !me) return null;
    const tt = view.tab;
    const s = stateOf(tt, now);
    if (s === "working" || s === "closed" || s === "invited") return null;
    if (me !== tt.payer.toLowerCase() && me !== tt.payee.toLowerCase()) return null;
    if (earnedAt(tt, now) - tt.paid < 1000n) return null;
    return `${s}:${tt.paid}`;
  })();
  useEffect(() => {
    if (!id || !stopKey || settledFor.current === stopKey) return;
    settledFor.current = stopKey;
    let cancelled = false;
    // The relayer pays a tab at most once every few blocks, so wait out the block that stopped the clock and try a few times.
    (async () => {
      for (const wait of [5000, 6000, 8000]) {
        await new Promise((r) => setTimeout(r, wait));
        if (cancelled) return;
        try {
          await settleNow(id);
          refresh();
          return;
        } catch {}
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, stopKey, refresh]);

  if (!id) return <Missing text="That isn't a tab number." />;
  if (error && !view) return <Missing text={error} />;
  if (!views) return <Loading />;
  if (!exists || !t) return <Missing text={`There's no tab № ${id.toString().padStart(4, "0")} yet.`} />;

  const payee = personOf(t.payee, profiles, "invited by link");
  const payer = personOf(t.payer, profiles);
  const cur = currency(payee.currency);
  const iAmPayee = me === t.payee.toLowerCase();
  const iAmPayer = me === t.payer.toLowerCase();
  const earned = earnedAt(t, now);
  const owed = earned - t.paid;
  const remaining = t.budget - earned;
  const runway = t.rate > 0n ? (Number(remaining) * 3600) / Number(t.rate) : 0;
  const money = (usd: number) => (rates && cur.code !== "USD" ? `${formatMoney(usd, cur, rates)} (${formatUsd(usd, 2)})` : formatUsd(usd, 2));
  const lastPaid = lines?.find((l) => l.kind === "paid");
  const everClockedIn = !!lines?.some((l) => l.kind === "in");
  const isDemo = DEMO_FREELANCERS.some((f) => f.address.toLowerCase() === t.payee.toLowerCase());

  const go = (what: string, fn: string, args: readonly unknown[]) =>
    act.run(what, async (sent) => {
      const p = relay(wallet, fn, args);
      sent();
      const r = await p;
      refresh();
      return r;
    });
  /** The button that started an action says what it's waiting for; the others just lock. */
  const label = (what: string, idle: string) => (act.busy && act.which === what ? busyLabel(act.phase, idle) : idle);
  const closedLine = lines?.find((l) => l.kind === "closed");
  const closeButton = (idle: string) =>
    confirmClose ? (
      <span className={styles.confirm} role="group" aria-label="Confirm closing the tab">
        <span>Close for good? {iAmPayer ? `${payee.name} keeps what they earned and ${formatUsd(toUsd(remaining > 0n ? remaining : 0n))} comes back to you.` : `You keep what you earned; the rest goes back to ${payer.name}.`}</span>
        <button
          className="btn small primary"
          disabled={act.busy}
          onClick={() => {
            setConfirmClose(false);
            go("Tab closed", "close", [view!.id]);
          }}
        >
          {label("Tab closed", "Yes, close the tab")}
        </button>
        <button className="btn small quiet" disabled={act.busy} onClick={() => setConfirmClose(false)}>
          Keep it open
        </button>
      </span>
    ) : (
      <button className="btn quiet" disabled={act.busy} onClick={() => setConfirmClose(true)}>
        {label("Tab closed", idle)}
      </button>
    );

  const topUpUnits = Number(topUp) > 0 ? toUnits(Number(topUp)) : 0n;
  const topUpProblem = !(Number(topUp) > 0)
    ? "Enter an amount."
    : Number(topUp) < 0.5
      ? "The smallest top-up is $0.50."
      : balance != null && topUpUnits > balance
        ? "That's more than your wallet holds."
        : null;

  return (
    <main className={`wrap ${styles.page}`}>
      <div className={styles.noteWrap}>
        <TabNote view={view!} profiles={profiles} lastPaidAt={lastPaid?.time} engrave />
        <div className={styles.noteBar}>
          <span className="soft">
            Tab <span className="serial">№ {view!.id.toString().padStart(4, "0")}</span>
            {lines?.find((l) => l.kind === "opened")?.time ? `, opened ${new Date(lines.find((l) => l.kind === "opened")!.time * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : ""}
          </span>
          <button
            className={styles.copy}
            onClick={() => navigator.clipboard?.writeText(window.location.href).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })}
          >
            {copied ? "Link copied" : "Copy link to this tab"}
          </button>
        </div>
      </div>

      <div className={styles.grid}>
        <section className={styles.controls} aria-label="Actions">
          {iAmPayee && (
            <>
              <h2>{state === "working" ? "You're on the clock" : "You're the freelancer on this tab"}</h2>
              <div className={styles.buttons}>
                {state === "idle" && (
                  <button className="btn live" disabled={act.busy} onClick={() => go("Clocked in", "clockIn", [view!.id])}>
                    {label("Clocked in", "Clock in")}
                  </button>
                )}
                {state === "working" && (
                  <button className="btn primary" disabled={act.busy} onClick={() => go("Clocked out", "clockOut", [view!.id])}>
                    {label("Clocked out", "Clock out")}
                  </button>
                )}
                {owed > 1000n && (
                  <button
                    className="btn"
                    disabled={act.busy}
                    onClick={() =>
                      act.run(`Cashed out ${formatUsd(toUsd(owed), 4)}`, async (sent) => {
                        sent();
                        const r = await settleNow(view!.id);
                        refresh();
                        return r;
                      })
                    }
                  >
                    {act.busy && act.which?.startsWith("Cashed out") ? busyLabel(act.phase, "Cash out") : `Cash out ${formatUsd(toUsd(owed), 2)} now`}
                  </button>
                )}
                {state !== "closed" && closeButton("Close tab")}
              </div>
              {state === "closed" && (
                <p className="soft">
                  This tab is closed. You were paid {money(toUsd(t.paid))} in all{closedLine?.amount != null ? `, and ${formatUsd(toUsd(closedLine.amount))} went back to ${payer.name}` : ""}.
                </p>
              )}
              {state === "paused" && <p className="notice">{payer.name} has paused pay. You can clock in again when they resume it.</p>}
              {state === "spent" && <p className="notice">The budget is used up. {payer.name} can top it up to keep the clock running.</p>}
            </>
          )}

          {iAmPayer && (
            <>
              <h2>{state === "closed" ? `You paid ${payee.name}` : `You're paying ${payee.name}`}</h2>
              {state === "invited" && (invite ? <InviteBox link={invite} /> : <p className="notice">The invite link was made in another browser. Open it there, or close this tab to get the budget back.</p>)}
              {state === "idle" && lines != null && !everClockedIn && (
                <p className={styles.waiting} role="status">
                  <i aria-hidden />
                  {isDemo
                    ? `${payee.name.split(" ")[0]} clocks in by themselves, usually within a few seconds and a minute at most. The note starts printing the moment they do.`
                    : `Waiting for ${payee.name} to clock in. They do it from their Till account; the note starts printing the moment they do.`}
                </p>
              )}
              {state === "idle" && everClockedIn && isDemo && (
                <p className="soft">{payee.name.split(" ")[0]} has clocked out for now. Demo freelancers work up to 45 minutes on a tab; top up or close it whenever you like.</p>
              )}
              <div className={styles.buttons}>
                {(state === "working" || state === "idle") && (
                  <button className="btn" disabled={act.busy} onClick={() => go("Pay paused", "hold", [view!.id, true])}>
                    {label("Pay paused", "Pause pay")}
                  </button>
                )}
                {state === "paused" && (
                  <button className="btn primary" disabled={act.busy} onClick={() => go("Pay resumed", "hold", [view!.id, false])}>
                    {label("Pay resumed", "Resume pay")}
                  </button>
                )}
                {state !== "closed" && (
                  <button className="btn" disabled={act.busy} onClick={() => setShowTopUp((s) => !s)} aria-expanded={showTopUp}>
                    Top up
                  </button>
                )}
                {state !== "closed" && closeButton(`Close and get ${formatUsd(toUsd(remaining > 0n ? remaining : 0n))} back`)}
              </div>
              {state === "closed" && (
                <p className="soft">
                  This tab is closed. {payee.name} was paid {money(toUsd(t.paid))} in all{closedLine?.amount != null ? `, and ${formatUsd(toUsd(closedLine.amount))} came back to you` : ""}.
                </p>
              )}
              {showTopUp && (
                <form
                  className={styles.topup}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (topUpProblem) return;
                    act.run(`Topped up ${formatUsd(Number(topUp))}`, async (sent) => {
                      const permit = await signPermit(wallet, topUpUnits);
                      const p = relay(wallet, "topUpWithPermit", [view!.id, topUpUnits, permit.deadline, permit.v, permit.r, permit.s]);
                      sent();
                      const r = await p;
                      setShowTopUp(false);
                      setTopUp("");
                      refresh();
                      return r;
                    });
                  }}
                >
                  <div className="field">
                    <label htmlFor="topup">Add to the budget (AUSD)</label>
                    <input id="topup" className="input" inputMode="decimal" value={topUp} onChange={(e) => setTopUp(e.target.value)} placeholder="5.00" />
                    <span className="hint">Wallet: {balance == null ? "…" : formatUsd(toUsd(balance))}</span>
                  </div>
                  <button className="btn primary" disabled={!!topUpProblem || act.busy}>
                    {act.busy && act.which?.startsWith("Topped up") ? busyLabel(act.phase, "Add to budget") : "Add to budget"}
                  </button>
                </form>
              )}
            </>
          )}

          {!iAmPayee && !iAmPayer && (
            <>
              <h2>Watching this tab</h2>
              <p className="soft">
                Anyone can watch a tab. Only {payer.name} and {payee.name} can change it.{" "}
                {!wallet.address && "Sign in to open a tab of your own."}
              </p>
              <div className={styles.buttons}>
                <Link href="/open" className="btn primary">
                  Open a tab of your own
                </Link>
              </div>
            </>
          )}

          <ErrorLine error={act.error} />
          <LandedLine landed={act.landed} />

          {state === "working" && (
            <div className={styles.payouts} aria-live="polite">
              <p className={styles.payoutsHead}>{PACE_WORDS[pace] ?? PACE_WORDS[6_000]}</p>
              {payouts.length === 0 ? (
                <p className="soft">First payout in a moment…</p>
              ) : (
                <ul>
                  {payouts.map((p) => (
                    <li key={p.hash}>
                      <span>{money(p.amount)}</span> landed in {(p.ms / 1000).toFixed(2)} s,{" "}
                      <a className="serial" href={explorerTx(p.hash)} target="_blank" rel="noreferrer">
                        block {p.block.toLocaleString("en-US")}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className={styles.facts} aria-label="Tab details">
          <dl>
            <div>
              <dt>Rate</dt>
              <dd>{formatUsd(toUsd(t.rate))} an hour</dd>
            </div>
            <div>
              <dt>Earned</dt>
              <dd>{money(toUsd(earned))}</dd>
            </div>
            <div>
              <dt>Paid out</dt>
              <dd>{money(toUsd(t.paid))}</dd>
            </div>
            <div>
              <dt>Budget left</dt>
              <dd>
                {formatUsd(toUsd(remaining > 0n ? remaining : 0n))}
                {state !== "closed" && runway > 0 && <span className="soft"> covers {formatDuration(runway)}</span>}
              </dd>
            </div>
            <div>
              <dt>Between</dt>
              <dd>
                {payer.name}
                {payer.place ? `, ${payer.place}` : ""} and {payee.name}
                {payee.place && !isZero(t.payee) ? `, ${payee.place}` : ""}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {lines && lines.length > 1 && (
        <section className={styles.stub}>
          <h2 id="timecard">Time card</h2>
          <p className="soft">
            {more ? "The most recent stretch of this tab. " : ""}Red is time on the clock, hatched is pay paused, and the line is money that has
            reached the freelancer.
          </p>
          <TimeCard lines={lines} now={now} earnedUsd={toUsd(earned)} running={state === "working"} partial={more} />
        </section>
      )}

      <section className={styles.stub}>
        <h2 id="paystub">Pay stub</h2>
        <p className="soft">Every change to this tab, straight from Monad. Each line links to its transaction.</p>
        {lines == null ? (
          <div className={`skeleton ${styles.stubSkel}`} />
        ) : lines.length === 0 ? (
          <p className="soft">Nothing yet.</p>
        ) : (
          <ol className={styles.lines}>
            {lines.map((l, i) => (
              <li key={`${l.hash}-${l.kind}-${i}`}>
                <span className={styles.when}>{ago(now - l.time)}</span>
                <span className={styles.what}>{describe(l, payer.name, payee.name, money)}</span>
                <a className="serial" href={explorerTx(l.hash)} target="_blank" rel="noreferrer">
                  block {l.block.toLocaleString("en-US")}
                </a>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function describe(l: StubLine, payer: string, payee: string, money: (usd: number) => string): string {
  const amt = l.amount != null ? toUsd(l.amount) : 0;
  switch (l.kind) {
    case "opened":
      return `${payer} opened the tab with ${formatUsd(amt)}`;
    case "claimed":
      return `${payee} joined from the invite`;
    case "in":
      return `${payee} clocked in`;
    case "out":
      return `Clock stopped`;
    case "held":
      return `${payer} paused pay`;
    case "resumed":
      return `${payer} resumed pay`;
    case "rate":
      return `Rate changed to ${formatUsd(amt)} an hour`;
    case "topup":
      return `${payer} added ${formatUsd(amt)}`;
    case "paid":
      return `Paid ${money(amt)} to ${payee}`;
    case "closed":
      return `Tab closed, ${formatUsd(amt)} back to ${payer}`;
  }
}

function Loading() {
  return (
    <main className={`wrap ${styles.page}`} aria-busy="true">
      <div className={`skeleton ${styles.noteSkel}`} />
    </main>
  );
}

function Missing({ text }: { text: string }) {
  return (
    <main className={`wrap ${styles.page}`}>
      <h1 className={styles.missing}>{text}</h1>
      <p>
        <Link href="/app">See your tabs</Link> or <Link href="/open">open a new one</Link>.
      </p>
    </main>
  );
}
