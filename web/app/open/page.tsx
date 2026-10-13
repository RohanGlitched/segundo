"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { decodeEventLog, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Note } from "@/components/Note";
import { ErrorLine, LandedLine, SignInPanel, busyLabel, useAction } from "@/components/ui";
import { tillAbi } from "@/lib/abi";
import { explorerTx, publicClient } from "@/lib/chain";
import { DEMO_FREELANCERS } from "@/lib/demo";
import { dripOnce, useAutoDrip, useProfile, useDollarBalance } from "@/lib/hooks";
import { inviteLink, saveInvite } from "@/lib/invite";
import { hasPasskeyKeys, inviteKeysHeld, nextInviteKey } from "@/lib/keys";
import { InviteBox } from "@/components/InviteBox";
import { useLive } from "@/lib/live";
import { MIN_RATE_USD, currency, feeFor, formatDuration, formatFee, formatMoney, formatUsd, parseAmount, toUsd } from "@/lib/money";
import { relay, signFee, signPermit, type Landed } from "@/lib/relay";
import { groupedAddress, parseRequest } from "@/lib/request";
import { gasPaused, useHealth } from "@/lib/health";
import { useWallet } from "@/lib/wallet";
import styles from "./open.module.css";

type Who = "invite" | "demo" | "address";

/** What the page shows once a tab is open; kept in sessionStorage so Back from the tab page brings it back. */
type Receipt = { id: bigint; link?: string; next: string; landed?: Landed & { what: string } };
const RECEIPT = (id: string) => `segundo.receipt.${id}`;

function saveReceipt(r: Receipt) {
  try {
    const { landed } = r;
    const fee = landed?.fee && { ...landed.fee, value: landed.fee.value.toString() };
    sessionStorage.setItem(RECEIPT(r.id.toString()), JSON.stringify({ ...r, id: r.id.toString(), landed: landed && { ...landed, fee } }));
  } catch {}
}
function loadReceipt(id: string): Receipt | null {
  try {
    const raw = sessionStorage.getItem(RECEIPT(id));
    if (!raw) return null;
    const r = JSON.parse(raw);
    const fee = r.landed?.fee && { ...r.landed.fee, value: BigInt(r.landed.fee.value) };
    return { ...r, id: BigInt(r.id), landed: r.landed && { ...r.landed, fee } };
  } catch {
    return null;
  }
}

export default function OpenTab() {
  const wallet = useWallet();
  const me = wallet.address;
  const health = useHealth();
  const paused = gasPaused(health, "open");
  const { rates } = useLive();
  const { balance, refresh: refreshBalance } = useDollarBalance(me);
  const myProfile = useProfile(me);
  const [who, setWho] = useState<Who>("demo");
  const [demo, setDemo] = useState(0);
  const [addr, setAddr] = useState("");
  const [rate, setRate] = useState("30");
  const [budget, setBudget] = useState("5");
  const [memo, setMemo] = useState("");
  const [opened, setOpened] = useState<Receipt | null>(null);
  const act = useAction();
  const faucet = useAction();
  const drip = useAutoDrip(me, balance, refreshBalance);
  // While the first 25 test AUSD are on their way, don't tell people their wallet is empty.
  const shownBalance = drip.sending ? null : balance;

  // Back from a tab just opened (/open?opened=N): the receipt again, not an empty form that invites a second tab.
  // Otherwise, a freelancer's request link (/open?to=&rate=&budget=&memo=&from=) fills in the form.
  const [asked, setAsked] = useState<{ from: string; to: Address } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const back = q.get("opened");
    const receipt = back && /^\d+$/.test(back) ? loadReceipt(back) : null;
    if (receipt) return setOpened(receipt);
    const r = parseRequest(q);
    if (!r) return;
    setWho("address");
    setAddr(r.to);
    if (r.rate != null) setRate(String(r.rate));
    if (r.budget != null) setBudget(String(r.budget));
    if (r.memo) setMemo(r.memo);
    setAsked({ from: r.from, to: r.to });
  }, []);
  const askedBanner = asked && (
    <p className="notice" role="status" style={{ overflowWrap: "anywhere" }}>
      <b>{asked.from || "A freelancer"} asked you to open this tab.</b> The pay goes to <span className="serial">{groupedAddress(asked.to)}</span>. Check
      this address with {asked.from.split(" ")[0] || "them"} before you fund it; you can change anything below.
      {addr.toLowerCase() !== asked.to.toLowerCase() ? " You've changed the address since." : ""}
    </p>
  );

  if (!wallet.ready) return <main className={`wrap ${styles.page}`} aria-busy="true" />;
  if (!me)
    return (
      <main className={`wrap ${styles.page}`}>
        <SignInPanel title="Sign in to open a tab" level={1}>
          {askedBanner}
          <p>You fund the tab with test AUSD; the freelancer is paid every second they&apos;re clocked in.</p>
        </SignInPanel>
      </main>
    );

  // Typed amounts go through one parser (lib/money.ts): "2,5" is two and a half, "1e3" is refused.
  const rateIn = parseAmount(rate);
  const budgetIn = parseAmount(budget);
  const rateUnits = rateIn.units ?? 0n;
  const budgetUnits = budgetIn.units ?? 0n;
  const rateN = toUsd(rateUnits);
  const budgetN = toUsd(budgetUnits);
  // The client pays Segundo's 1% on top of the budget; the freelancer's side is the whole budget.
  const feeUnits = feeFor(budgetUnits);
  const totalUnits = budgetUnits + feeUnits;
  const pick = DEMO_FREELANCERS[demo]!;
  const payee: Address | null =
    who === "demo" ? pick.address : who === "address" ? (isAddress(addr) ? (addr as Address) : null) : zeroAddress;

  const problem =
    who === "address" && !isAddress(addr)
      ? "Paste the freelancer's wallet address, or invite them by link instead."
      : payee?.toLowerCase() === me.toLowerCase()
        ? "That's your own wallet. Invite the freelancer by link instead."
        : rateIn.problem
          ? `Hourly rate: ${rateIn.problem}`
          : rateN < MIN_RATE_USD
            ? `The lowest hourly rate is ${formatUsd(MIN_RATE_USD)}.`
            : rateN > 1000
              ? "Keep the hourly rate under $1,000 on testnet."
              : budgetIn.problem
                ? `Budget: ${budgetIn.problem}`
                : budgetN < 0.5
                ? "The smallest tab is $0.50."
              : shownBalance != null && totalUnits > shownBalance
                ? `The budget plus the 1% fee comes to ${formatFee(totalUnits)}, more than the ${formatUsd(toUsd(shownBalance))} in your wallet.`
                : memo.length > 48
                  ? "Keep the description under 48 characters."
                  : null;
  const covers = rateN > 0 && budgetN > 0 ? formatDuration((budgetN / rateN) * 3600) : "—";
  const previewCur = currency(who === "demo" ? pick.currency : "USD");
  const previewPayee = who === "demo" ? { name: pick.name, place: pick.place } : { name: "Your freelancer", place: "anywhere" };
  const myName = myProfile?.name || "You";

  const submit = () =>
    act.run("Tab opened", async (sent) => {
      let inviteKey: Hex | null = null;
      let invite: Address = zeroAddress;
      if (who === "invite") {
        // Passkey accounts: the invite key comes from the passkey and the tab's slot on chain, so the link can be
        // rebuilt on any device (lib/keys.ts). Email and practice accounts have no passkey: a random key, kept here.
        inviteKey = hasPasskeyKeys(wallet) ? (await nextInviteKey(wallet)).key : generatePrivateKey();
        invite = privateKeyToAccount(inviteKey).address;
      }
      const permit = await signPermit(wallet, budgetUnits);
      const fee = await signFee(wallet, budgetUnits);
      const p = relay(wallet, "openWithPermit", [
        payee ?? zeroAddress,
        invite,
        rateUnits,
        budgetUnits,
        memo.trim(),
        permit.deadline,
        permit.v,
        permit.r,
        permit.s,
      ], fee);
      sent();
      const landed = await p;
      const receipt = await publicClient.getTransactionReceipt({ hash: landed.hash });
      let id = 0n;
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: tillAbi, data: log.data, topics: log.topics });
          if (ev.eventName === "Opened") id = (ev.args as { id: bigint }).id;
        } catch {}
      }
      if (inviteKey) saveInvite(id, inviteKey);
      const done: Receipt = {
        id,
        link: inviteKey ? inviteLink(id, inviteKey) : undefined,
        next:
          who === "demo"
            ? `${pick.name} will clock in by themselves in a few seconds. Watch the note print.`
            : "The freelancer can clock in from their Segundo account now.",
        landed: { ...landed, what: "Tab opened" },
      };
      saveReceipt(done);
      // The address bar now names the receipt, so Back from the tab page lands here again.
      window.history.replaceState(null, "", `/open?opened=${id}`);
      setOpened(done);
      refreshBalance();
      return landed;
    });

  if (opened)
    return (
      <main className={`wrap ${styles.page}`}>
        <div className={styles.done}>
          <h1 className={styles.h1}>Tab № {opened.id.toString().padStart(4, "0")} is open.</h1>
          <LandedLine landed={opened.landed ?? null} />
          <FeeLine fee={opened.landed?.fee} />
          {opened.link ? <InviteBox link={opened.link} /> : <p>{opened.next}</p>}
          <div className={styles.row}>
            <Link className="btn primary" href={`/tab/${opened.id}`}>
              Go to the tab
            </Link>
            <Link className="btn" href="/app">
              Your tabs
            </Link>
            <a className="btn quiet" href="/open">
              Open another tab
            </a>
          </div>
        </div>
      </main>
    );

  return (
    <main className={`wrap ${styles.page}`}>
      <div className={styles.layout}>
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (!problem && !act.busy) submit();
          }}
        >
          <h1 className={styles.h1}>Open a tab</h1>
          {askedBanner}

          <fieldset className={styles.who}>
            <legend>Who are you paying?</legend>
            <label className={styles.choice}>
              <input type="radio" name="who" checked={who === "demo"} onChange={() => setWho("demo")} />
              <span>
                <b>A demo freelancer</b>
                <span className="soft">They clock in on their own a few seconds after you open the tab.</span>
              </span>
            </label>
            {who === "demo" && (
              <div className={styles.people}>
                {DEMO_FREELANCERS.map((f, i) => (
                  <button
                    type="button"
                    key={f.address}
                    className={styles.person}
                    aria-pressed={demo === i}
                    onClick={() => setDemo(i)}
                    style={{ ["--ink-c" as string]: currency(f.currency).ink }}
                  >
                    <b>{f.name}</b>
                    <span>
                      {f.work}, {f.place}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <label className={styles.choice}>
              <input type="radio" name="who" checked={who === "invite"} onChange={() => setWho("invite")} />
              <span>
                <b>Someone I&apos;ll invite by link</b>
                <span className="soft">You get a link to send by email or chat. They sign in with their email and join.</span>
              </span>
            </label>
            <label className={styles.choice}>
              <input type="radio" name="who" checked={who === "address"} onChange={() => setWho("address")} />
              <span>
                <b>A wallet address</b>
                <span className="soft">If they already use Segundo or another Monad wallet.</span>
              </span>
            </label>
            {who === "address" && (
              <input className="input" placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value.trim())} aria-label="Freelancer's wallet address" />
            )}
          </fieldset>

          <div className={styles.pair}>
            <div className="field">
              <label htmlFor="rate">Hourly rate</label>
              <div className={styles.money}>
                <span aria-hidden>$</span>
                <input id="rate" className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
              </div>
              <span className="hint">
                {rateN >= MIN_RATE_USD && who === "demo" && rates && previewCur.code !== "USD"
                  ? `For ${pick.name.split(" ")[0]} that's ${formatMoney(rateN, previewCur, rates)} an hour, ${formatMoney(rateN / 3600, { ...previewCur, digits: 2 }, rates)} a second.`
                  : rateN >= MIN_RATE_USD
                    ? `Paid by the second: ${formatUsd(rateN / 3600, 4)} a second.`
                    : `AUSD per hour, at least ${formatUsd(MIN_RATE_USD)}, paid by the second.`}
              </span>
            </div>
            <div className="field">
              <label htmlFor="budget">Budget</label>
              <div className={styles.money}>
                <span aria-hidden>$</span>
                <input id="budget" className="input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
              </div>
              <span className="hint">Covers {covers} of work. Unspent budget comes back when the tab closes.</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="memo">What it&apos;s for (optional)</label>
            <input id="memo" className="input" maxLength={48} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Logo for the autumn launch" />
          </div>

          {budgetUnits > 0n && (
            <div className={styles.bill}>
              <dl className={styles.fees} aria-label="What you pay">
                <dt>Budget</dt>
                <dd>{formatUsd(toUsd(budgetUnits))}</dd>
                <dt>Segundo fee (1%)</dt>
                <dd>{formatFee(feeUnits)}</dd>
                <dt className={styles.total}>You pay</dt>
                <dd className={styles.total}>{formatFee(totalUnits)}</dd>
              </dl>
              <p className="soft">
                {who === "demo" ? pick.name.split(" ")[0] : "The freelancer"} pays nothing: the whole budget is theirs to earn. When the tab closes, unspent budget comes back with its 1% fee.
              </p>
            </div>
          )}

          <div className={styles.submit}>
            <button className="btn primary" disabled={!!problem || act.busy || paused}>
              {busyLabel(act.phase, budgetUnits > 0n ? `Open tab and pay ${formatFee(totalUnits)}` : "Open tab")}
            </button>
            <span className="soft">
              {drip.sending ? "Sending you 25 test AUSD…" : `Wallet: ${balance == null ? "…" : formatUsd(toUsd(balance))}.`}{" "}
              {shownBalance != null && shownBalance < totalUnits && (
                <button
                  type="button"
                  className={styles.inlineBtn}
                  disabled={faucet.busy}
                  onClick={() =>
                    faucet.run("25 test AUSD arrived", async (sent) => {
                      sent();
                      const r = await dripOnce(me);
                      refreshBalance();
                      return r;
                    })
                  }
                >
                  {faucet.busy ? "Sending test AUSD…" : "Get 25 test AUSD"}
                </button>
              )}
            </span>
          </div>
          {problem && <p className={styles.why}>{problem}</p>}
          {paused && !problem && <p className={styles.why}>The relayer is short of test MON right now, so opening a tab is paused. Try again in a little while; your wallet and balance are unchanged.</p>}
          <p className="soft">
            Your account signs three things in one step: permission to take the budget, the 1% fee, and the tab itself. No pop-ups, no gas.
            {who === "invite" &&
              hasPasskeyKeys(wallet) &&
              ` The invite key comes from your passkey, so you can rebuild the link on any device${inviteKeysHeld(wallet) ? "" : "; your passkey asks once to make it"}.`}
          </p>
          <ErrorLine error={act.error ?? faucet.error} />
          <LandedLine landed={faucet.landed ?? drip.landed} />
        </form>

        <aside className={styles.preview} aria-label="What the freelancer will see">
          <p className={styles.previewLabel}>What {who === "demo" ? pick.name : "they"} will see</p>
          <Note
            id={0}
            usd={0}
            cur={previewCur}
            rates={rates}
            payee={previewPayee}
            payer={{ name: myName, place: myProfile?.place || "abroad" }}
            rateUsd={rateN > 0 ? rateN : 0}
            hours={0}
            live={false}
            lines={{
              sub: "$0.00 in AUSD",
              main: (
                <>
                  Paid to <b>{previewPayee.name}</b>, {previewPayee.place}
                </>
              ),
              extra: [`by ${myName}`, myProfile?.place || "abroad", `at ${formatUsd(rateN > 0 ? rateN : 0)} an hour`].join(", "),
            }}
            status={rateN > 0 && budgetN > 0 ? `Ready to clock in, up to ${covers}` : "Set a rate and a budget"}
          />
          <ol className={styles.next}>
            <li>
              <span>
              <b>The budget moves into the Segundo contract.</b> Not to us: the contract can only pay {who === "demo" ? pick.name.split(" ")[0] : "the freelancer"} for time on the clock or send it back to you. Segundo&apos;s 1% fee is a separate transfer you can see on Monad.
            </span>
            </li>
            <li>
              <span>
              <b>{who === "demo" ? `${pick.name.split(" ")[0]} clocks in.` : "They join and clock in."}</b>{" "}
              {who === "demo" ? "Demo freelancers start by themselves within a few seconds." : who === "invite" ? "You'll get a link to send them; it works once." : "They clock in from their Segundo account."}
            </span>
            </li>
            <li>
              <span>
              <b>Pay lands as they work.</b> Watch the note print. Pause pay or close the tab whenever you like; unspent budget comes straight back.
            </span>
            </li>
          </ol>
        </aside>
      </div>
    </main>
  );
}

/** Segundo's fee went in its own transaction, so the receipt links it next to the open's. */
function FeeLine({ fee }: { fee?: Landed["fee"] }) {
  if (!fee) return null;
  if (!fee.hash) return <p className={styles.feeLine}>{fee.error ?? "The tab is funded, but Segundo's fee didn't go through."}</p>;
  return (
    <p className={styles.feeLine} role="status">
      Segundo&apos;s 1% fee, {formatFee(fee.value)}, went to the treasury in its own transaction,{" "}
      <a className="serial" href={explorerTx(fee.hash)} target="_blank" rel="noreferrer">
        block {fee.block?.toLocaleString("en-US")}
      </a>
      .
    </p>
  );
}
