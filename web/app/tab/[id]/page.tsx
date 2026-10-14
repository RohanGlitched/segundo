"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { InviteBox } from "@/components/InviteBox";
import { RebuildInvite } from "@/components/RebuildInvite";
import { TabNote, personOf } from "@/components/TabNote";
import { TimeCard } from "@/components/TimeCard";
import { ErrorLine, LandedLine, busyLabel, useAction } from "@/components/ui";
import { explorerTx } from "@/lib/chain";
import { useHistory, useTabs, useDollarBalance, type StubLine } from "@/lib/hooks";
import { inviteLink, loadInvite } from "@/lib/invite";
import { useChainNow, useLive } from "@/lib/live";
import { ago, currency, feeFor, formatCents, formatDuration, formatFee, formatMoney, formatUsd, parseAmount, toUsd } from "@/lib/money";
import { relay, settleNow, signFee, signPermit, type Landed } from "@/lib/relay";
import { DEMO_FREELANCERS } from "@/lib/demo";
import { earnedAt, isZero, stateOf } from "@/lib/tabs";
import { PROMPT_FREE_LABEL, asksForPasskey, passkeyHint, useWallet } from "@/lib/wallet";
import { StatePage } from "@/components/StatePage";
import { GrandRosette } from "@/components/home/Art";
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
  6_000: "Pay is earned every second on Monad. While this page is open it is also paid out every few seconds.",
  20_000: "Pay is earned every second on Monad. While this page is open it is paid out every 20 seconds.",
  60_000: "Pay is earned every second on Monad. While this page is open it is paid out once a minute.",
};
/** The guarantee behind the pace: closing the page never stops pay. */
const PACE_AWAY = "Close the page and nothing stops: Segundo's keeper pays out what's earned every few minutes, and the freelancer can collect it at any time.";

/** The receipt /open saved for a tab it just opened (app/open/page.tsx), shown once on arrival. */
type Arrival = { ms?: number; block?: number; hash?: string; fee?: { value?: string; hash?: string; block?: number; error?: string } };
function readArrival(id: string): Arrival | null {
  try {
    if (!new URLSearchParams(window.location.search).has("opened")) return null;
    const raw = sessionStorage.getItem(`segundo.receipt.${id}`);
    return raw ? ((JSON.parse(raw) as { landed?: Arrival }).landed ?? null) : null;
  } catch {
    return null;
  }
}

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
  const { lines, more, loading: historyLoading, reload: reloadHistory } = useHistory(id, view?.tab.lastBlock, 30);
  // Just opened from /open: the receipt (when it landed, the fee's own transaction) as one line above the note.
  const [arrival, setArrival] = useState<Arrival | null>(null);
  useEffect(() => {
    if (!id) return;
    const a = readArrival(id.toString());
    if (!a) return;
    setArrival(a);
    window.history.replaceState(null, "", `/tab/${id}`);
  }, [id]);
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
    let stopped = false;
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
      // A payout still in flight when the clock stops must not start another round.
      if (!stopped) timer = setTimeout(tick, every);
    };
    // The first payout is asked for at once: the server waits (up to 3 s) for the clock-in's block to settle and the
    // first half cent to build up, so it lands seconds after the clock-in instead of on the next round.
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
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

  // A tab closed from another window: once the stub has caught up with the tab, it ends with the close.
  const closedNow = !!view?.tab.closed;
  const stubHasClose = !!lines?.some((l) => l.kind === "closed");
  useEffect(() => {
    if (!closedNow || stubHasClose || historyLoading) return;
    let tries = 0;
    const timer = setInterval(() => {
      if (++tries > 6) return clearInterval(timer);
      reloadHistory();
    }, 3000);
    return () => clearInterval(timer);
  }, [closedNow, stubHasClose, historyLoading, reloadHistory]);

  if (!id) return <Missing text="That isn't a tab number." />;
  if (error && !view) return <Missing text={error} />;
  if (!views) return <Loading />;
  if (!exists || !t) return <Missing text={`There's no tab № ${id.toString().padStart(4, "0")} yet.`} />;

  // "invited by link" only for a freelancer the history shows joining from an invite (the contract clears the invite
  // key on claim); otherwise a freelancer without a city is just their name or address.
  const invited = !!lines?.some((l) => l.kind === "claimed");
  const payee = personOf(t.payee, profiles, invited ? "invited by link" : "");
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
  // Until the history is read (or while only its newest line is in), keep the time card's place. A tab whose whole
  // history is one line (just opened) has no card, and the walk reaching "opened" says so.
  const timeCardPending = lines == null || (lines.length === 1 && lines[0]!.kind !== "opened");
  const isDemo = DEMO_FREELANCERS.some((f) => f.address.toLowerCase() === t.payee.toLowerCase());
  // A shift the budget ended: the contract still holds its start, and the clock stopped when the budget ran out.
  const spentAt =
    state === "spent" && t.since > 0n && t.rate > 0n ? Number(t.since) + Math.ceil((Number(t.budget - t.banked) * 3600) / Number(t.rate)) : undefined;

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
  // What went back to the client at close: the contract refunds budget minus paid, so it's known from the tab itself
  // without waiting for the pay stub (which would make the sentence grow a clause after the page is drawn).
  const refunded = t.budget > t.paid ? t.budget - t.paid : 0n;
  const openedAt = lines?.find((l) => l.kind === "opened")?.time;
  const closeButton = (idle: string) =>
    confirmClose ? (
      <span className={styles.confirm} role="group" aria-label="Confirm closing the tab">
        <span>
          Close for good?{" "}
          {iAmPayer && remaining <= 0n
            ? `${payee.name} keeps everything they earned. The budget is used up, so nothing comes back.`
            : iAmPayer
            ? `${payee.name} keeps what they earned and ${formatUsd(toUsd(remaining > 0n ? remaining : 0n))} comes back to you, with Segundo's 1% fee on it.`
            : `You keep what you earned; the rest goes back to ${payer.name}.`}
        </span>
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

  // The same parser as the open form: "2,5" is two and a half; exponents and stray characters are refused.
  const topUpIn = parseAmount(topUp);
  const topUpUnits = topUpIn.units ?? 0n;
  // Top-ups carry Segundo's 1% on top, like the budget did; the freelancer pays nothing.
  const topUpFee = feeFor(topUpUnits);
  const topUpProblem = topUpIn.problem
    ? topUpIn.problem
    : topUpUnits < 500_000n
      ? "The smallest top-up is $0.50."
      : balance != null && topUpUnits + topUpFee > balance
        ? `With the 1% fee that's ${formatFee(topUpUnits + topUpFee)}, more than your wallet holds.`
        : null;

  return (
    <main className={`wrap ${styles.page}`}>
      {arrival && (
        <p className={styles.arrival} role="status">
          <b>Tab opened.</b>
          {arrival.ms != null && arrival.block != null && arrival.hash && (
            <>
              {" "}
              Landed in {(arrival.ms / 1000).toFixed(2)} s,{" "}
              <a className="serial" href={explorerTx(arrival.hash)} target="_blank" rel="noreferrer">
                block {arrival.block.toLocaleString("en-US")}
              </a>
              .
            </>
          )}
          {arrival.fee?.hash && arrival.fee.value && (
            <>
              {" "}
              Segundo&apos;s 1% fee, {formatFee(BigInt(arrival.fee.value))}, went in its own transaction,{" "}
              <a className="serial" href={explorerTx(arrival.fee.hash)} target="_blank" rel="noreferrer">
                block {arrival.fee.block?.toLocaleString("en-US")}
              </a>
              .
            </>
          )}
          <button type="button" className={styles.arrivalClose} onClick={() => setArrival(null)} aria-label="Dismiss">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </p>
      )}
      <div className={styles.noteWrap}>
        <TabNote view={view!} profiles={profiles} lastPaidAt={lastPaid?.time} invited={invited} engrave />
        <div className={styles.noteBar}>
          <h1 className={styles.noteTitle}>
            Tab <span className="serial">№ {view!.id.toString().padStart(4, "0")}</span>
            {openedAt ? `, opened ${new Date(openedAt * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : ""}
          </h1>
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
                      act.run(`Collected ${formatCents(toUsd(owed))}`, async (sent) => {
                        sent();
                        const r = await settleNow(view!.id);
                        refresh();
                        return r;
                      })
                    }
                  >
                    {act.busy && act.which?.startsWith("Collected") ? busyLabel(act.phase, "Collect") : `Collect ${formatUsd(toUsd(owed), 2)} now`}
                  </button>
                )}
                {state !== "closed" && closeButton("Close tab")}
              </div>
              {state === "closed" && (
                <p className="soft">
                  {/* Dollars here, local money in the details beside it: the exchange rate arriving late mustn't rewrap this. */}
                  This tab is closed. You were paid {formatUsd(toUsd(t.paid))} in all{refunded > 0n ? `, and ${formatUsd(toUsd(refunded))} went back to ${payer.name}` : ""}.
                </p>
              )}
              {state === "paused" && <p className="notice">{payer.name} has paused pay. You can clock in again when they resume it.</p>}
              {state === "spent" && <p className="notice">The budget is used up. {payer.name} can top it up to keep the clock running.</p>}
            </>
          )}

          {iAmPayer && (
            <>
              <h2>{state === "closed" ? `You paid ${payee.name}` : `You're paying ${payee.name}`}</h2>
              {state === "invited" && (invite ? <InviteBox link={invite} /> : <RebuildInvite id={id!} invite={t.invite} onRebuilt={setInvite} />)}
              {state === "idle" && lines != null && !everClockedIn && (
                <p className={styles.waiting} role="status">
                  <i aria-hidden />
                  {isDemo
                    ? `${payee.name.split(" ")[0]} clocks in by themselves, usually within a few seconds and a minute at most. The note starts printing the moment they do.`
                    : `Waiting for ${payee.name} to clock in. They do it from their Segundo account; the note starts printing the moment they do.`}
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
                {state !== "closed" && closeButton(remaining > 0n ? `Close and get ${formatUsd(toUsd(remaining))} back` : "Close the tab")}
              </div>
              {state === "closed" && (
                <p className="soft">
                  This tab is closed. {payee.name} was paid {formatUsd(toUsd(t.paid))} in all{refunded > 0n ? `, and ${formatUsd(toUsd(refunded))} came back to you` : ""}.
                </p>
              )}
              {showTopUp && (
                <form
                  className={styles.topup}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (topUpProblem) return;
                    act.run(`Topped up ${formatUsd(toUsd(topUpUnits))}`, async (sent) => {
                      // Over $50 a passkey account confirms again (lib/wallet.tsx): ask now, while the tap is fresh.
                      if (asksForPasskey(wallet, topUpUnits)) await wallet.confirmWithPasskey(`Adding ${formatUsd(toUsd(topUpUnits))}`);
                      const permit = await signPermit(wallet, topUpUnits);
                      const fee = await signFee(wallet, topUpUnits);
                      const p = relay(wallet, "topUpWithPermit", [view!.id, topUpUnits, permit.deadline, permit.v, permit.r, permit.s], fee);
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
                    <span className="hint">
                      {topUpUnits > 0n
                        ? `Top-up ${formatUsd(toUsd(topUpUnits))} · Segundo fee (1%) ${formatFee(topUpFee)} · You pay ${formatFee(topUpUnits + topUpFee)}. `
                        : ""}
                      Wallet: {balance == null ? "…" : formatUsd(toUsd(balance))}
                      {wallet.kind === "mera" && `. ${passkeyHint(wallet, topUpUnits) ?? `Over ${PROMPT_FREE_LABEL}, Segundo asks for your passkey again.`}`}
                    </span>
                  </div>
                  <button className="btn primary" disabled={!!topUpProblem || act.busy}>
                    {act.busy && act.which?.startsWith("Topped up") ? busyLabel(act.phase, "Add to budget") : "Add to budget"}
                  </button>
                  {topUp.trim() && topUpProblem && (
                    <p className={styles.why} role="status">
                      {topUpProblem}
                    </p>
                  )}
                  <p className={`soft ${styles.feeNote}`}>
                    {payee.name.split(" ")[0]} pays nothing; the whole top-up is theirs to earn. Whatever is unspent when the tab closes comes back
                    with its 1% fee.
                  </p>
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
          {act.landed?.refund && <RefundLine refund={act.landed.refund} />}
          {act.landed?.fee && (
            <p className={styles.feeLine} role="status">
              {act.landed.fee.hash ? (
                <>
                  Segundo&apos;s 1% fee, {formatFee(act.landed.fee.value)}, went to the treasury in its own transaction,{" "}
                  <a className="serial" href={explorerTx(act.landed.fee.hash)} target="_blank" rel="noreferrer">
                    block {act.landed.fee.block?.toLocaleString("en-US")}
                  </a>
                  .
                </>
              ) : (
                act.landed.fee.error ?? "The top-up landed, but Segundo's fee didn't go through."
              )}
            </p>
          )}

          {state === "working" && (
            <div className={styles.payouts} aria-live="polite">
              <p className={styles.payoutsHead}>{PACE_WORDS[pace] ?? PACE_WORDS[6_000]}</p>
              <p className={styles.payoutsAway}>{PACE_AWAY}</p>
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
            {state === "closed" ? (
              <div>
                <dt>Returned to client</dt>
                <dd>{formatUsd(toUsd(refunded))}</dd>
              </div>
            ) : (
              <div>
                <dt>Budget left</dt>
                <dd>
                  {formatUsd(toUsd(remaining > 0n ? remaining : 0n))}
                  {runway > 0 && <span className="soft"> covers {formatDuration(runway)}</span>}
                </dd>
              </div>
            )}
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

      {timeCardPending && (
        <section className={styles.stub} aria-busy="true">
          <h2>Time card</h2>
          <p className="soft">Reading this tab&apos;s history from Monad…</p>
          <div className={styles.cardSkel}>
            <div className="skeleton" />
          </div>
        </section>
      )}
      {lines && lines.length > 1 && (
        <section className={styles.stub}>
          <h2 id="timecard">Time card</h2>
          <p className="soft">
            {more ? "The most recent stretch of this tab. " : ""}Red is time on the clock, hatched is pay paused, and the line is money that has
            reached the freelancer.
          </p>
          <TimeCard
            lines={lines}
            now={now}
            earnedUsd={toUsd(earned)}
            paidUsd={toUsd(t.paid)}
            running={state === "working"}
            partial={more}
            loading={historyLoading}
            since={Number(t.since)}
            stoppedAt={spentAt}
          />
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

/** At close the treasury sends back Segundo's 1% on the unspent budget, in its own transaction. */
function RefundLine({ refund }: { refund: NonNullable<Landed["refund"]> }) {
  if (refund.error) return <p className="soft">{refund.error}</p>;
  if (!refund.hash) return null;
  return (
    <p className="soft" role="status">
      Segundo&apos;s 1% on the unspent budget, {formatFee(refund.value)}, went back to the client from the treasury,{" "}
      <a className="serial" href={explorerTx(refund.hash)} target="_blank" rel="noreferrer">
        block {refund.block?.toLocaleString("en-US")}
      </a>
      .
    </p>
  );
}

/** The page's own shape while the tab is read: the note, the controls beside the facts, the time card. */
function Loading() {
  return (
    <main className={`wrap ${styles.page}`} aria-busy="true" aria-label="Reading the tab from Monad">
      <div className={`skeleton ${styles.noteSkel}`} />
      <div className={styles.grid}>
        <div className={styles.controls}>
          <div className={`skeleton ${styles.lineSkel}`} />
          <div className={`skeleton ${styles.btnSkel}`} />
        </div>
        <div className={`skeleton ${styles.factsSkel}`} />
      </div>
      <div className={`skeleton ${styles.cardSkelBox}`} />
    </main>
  );
}

function Missing({ text }: { text: string }) {
  return (
    <main>
      <StatePage
        eyebrow="Segundo tab"
        title={text}
        lede="A tab's address is its number on Monad. If someone sent you this link, check it with them; a tab opened a moment ago can take a few seconds to appear."
        art={<GrandRosette />}
        actions={
          <>
            <Link href="/app" className="btn primary">
              See your tabs
            </Link>
            <Link href="/open" className="btn">
              Open a new one
            </Link>
          </>
        }
      />
    </main>
  );
}
