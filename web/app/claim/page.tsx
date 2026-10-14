"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Note } from "@/components/Note";
import { ErrorLine, SignInPanel, useAction } from "@/components/ui";
import { explorerAddress, explorerTx } from "@/lib/chain";
import { useDollarBalance } from "@/lib/hooks";
import { useLive } from "@/lib/live";
import { CURRENCIES, currency, formatMoney, formatUsd, toUsd } from "@/lib/money";
import { sweepFromKey, type Landed } from "@/lib/relay";
import { findSentLink, linkBalance, readFragment, updateSentLink, type LinkFragment } from "@/lib/sendlink";
import { useWallet } from "@/lib/wallet";
import { StatePage } from "@/components/StatePage";
import { TornNote } from "@/components/StateArt";
import styles from "./claim.module.css";

type Got = Landed & { value: bigint; to: string; back: boolean };

/**
 * Someone opens a link a Segundo user sent them: they see the money in their own currency, make an account with a
 * passkey (or email, or a practice wallet), and the link's key moves everything it holds to that account.
 */
export default function Claim() {
  const wallet = useWallet();
  const { rates } = useLive();
  const [frag, setFrag] = useState<LinkFragment | null | undefined>(undefined);
  const [cur, setCur] = useState("USD");
  const [held, setHeld] = useState<bigint | null>(null);
  const [sentHere, setSentHere] = useState<string | null>(null);
  const [got, setGot] = useState<Got | null>(null);
  const { balance } = useDollarBalance(got ? wallet.address : undefined);
  const act = useAction();
  const moving = useRef(false);
  const sawSignedOut = useRef(false);
  const autoTried = useRef(false);

  useEffect(() => {
    const read = () => {
      const f = readFragment(window.location.hash);
      setFrag(f);
      setHeld(null);
      if (f) {
        setCur(f.cur);
        setSentHere(findSentLink(f.address)?.sender ?? null);
      }
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  // The link's balance on Monad is the truth: what the link says is only what the sender meant to put in it.
  useEffect(() => {
    if (!frag) return;
    let stop = false;
    const read = () =>
      linkBalance(frag.address)
        .then((b) => !stop && setHeld(b))
        .catch(() => {});
    read();
    const t = setInterval(read, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [frag]);

  const me = wallet.address;
  const isSender = !!me && !!sentHere && sentHere === me.toLowerCase();

  const collect = useCallback(() => {
    if (!frag || !me || moving.current) return;
    moving.current = true;
    const back = !!sentHere && sentHere === me.toLowerCase();
    act.run(back ? "Taken back" : "Collected", async (sent) => {
      try {
        sent();
        const r = await sweepFromKey(frag.key, me);
        if (back) updateSentLink(me, frag.address, { state: "back", backHash: r.hash });
        setGot({ ...r, to: me, back });
        setHeld(0n);
        return r;
      } finally {
        moving.current = false;
      }
    });
  }, [act, frag, me, sentHere]);

  // Someone who arrives signed out and then makes an account here gets the money straight away: one passkey tap.
  useEffect(() => {
    if (!wallet.ready) return;
    if (!me) {
      sawSignedOut.current = true;
      return;
    }
    if (sawSignedOut.current && !autoTried.current && held != null && held > 0n && !got && !isSender) {
      autoTried.current = true;
      collect();
    }
  }, [wallet.ready, me, held, got, isSender, collect]);

  if (frag === undefined) return <Shell busy />;
  if (frag === null)
    return (
      <main>
        <StatePage
          eyebrow="Money sent by link"
          title="This link is missing its key."
          lede="A Segundo link carries its own key after the #, and this one arrived without it. Nothing is lost: the money is still waiting at the link's address on Monad."
          art={<TornNote />}
          actions={
            <>
              <Link href="/" className="btn primary">
                What Segundo is
              </Link>
              <Link href="/app" className="btn">
                Your account
              </Link>
            </>
          }
        >
          <ul>
            <li>Ask the person who sent it to share it again: the whole link, including everything after the #.</li>
            <li>Some chat apps cut a link at the #. Copying it from the message, rather than tapping it, usually keeps it whole.</li>
            <li>Until someone collects it, the sender can take the money back from their own account.</li>
          </ul>
        </StatePage>
      </main>
    );

  const c = currency(cur);
  const usd = got ? toUsd(got.value) : held != null ? toUsd(held) : frag.usd;
  const local = formatMoney(usd, c, rates);
  const showLocal = c.code !== "USD" && !!rates?.[c.code];
  const from = frag.from || "Someone";
  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const empty = held === 0n && !got;
  const accountWord = wallet.kind === "mera" ? "your passkey account" : wallet.kind === "privy" ? "your email account" : "your practice wallet";

  const note = (
    <Note
      id={parseInt(frag.address.slice(-4), 16)}
      usd={usd}
      cur={c}
      rates={rates}
      payee={{ name: "You", place: "" }}
      payer={{ name: from, place: "" }}
      rateUsd={0}
      hours={got ? 3 : empty ? 0 : 0.12}
      live={held != null && held > 0n}
      status={got ? (got.back ? "Back with the sender" : "Collected") : empty ? "Already collected" : held == null ? "Checking the link…" : "Waiting for you to collect"}
      serialLine={got ? `block ${got.block.toLocaleString("en-US")}` : short(frag.address)}
      engrave
      lines={{
        sub: `${formatUsd(usd)} in AUSD`,
        main: (
          <>
            From <b>{from}</b>
          </>
        ),
        extra: "Sent by link with Segundo",
      }}
    />
  );

  return (
    <main className={`wrap ${styles.page}`}>
      <div className={styles.layout}>
        <div className={styles.copy}>
          {got ? (
            <>
              <p className={styles.kicker}>{got.back ? "Taken back" : "It's yours"}</p>
              <h1 className={styles.h1}>
                {got.back ? `${formatUsd(usd)} is back in your wallet.` : `${showLocal ? local : formatUsd(usd)} is in your account.`}
              </h1>
              <p className={styles.landed} role="status">
                Arrived in {(got.ms / 1000).toFixed(1)} s,{" "}
                <a className="serial" href={explorerTx(got.hash)} target="_blank" rel="noreferrer">
                  block {got.block.toLocaleString("en-US")}
                </a>
                .
              </p>
              <dl className={styles.facts}>
                <div>
                  <dt>Your balance</dt>
                  <dd data-testid="claim-balance">
                    {balance == null ? "Reading…" : formatUsd(toUsd(balance))} in AUSD
                    {balance != null && showLocal ? `, about ${formatMoney(toUsd(balance), c, rates)}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Held in</dt>
                  <dd>
                    {accountWord},{" "}
                    <a href={explorerAddress(got.to)} target="_blank" rel="noreferrer">
                      {short(got.to)}
                    </a>
                  </dd>
                </div>
              </dl>
              <div className={styles.actions}>
                <Link href="/app" className="btn primary">
                  Open Segundo
                </Link>
                <Link href="/app?send=1" className="btn">
                  Send money to someone
                </Link>
              </div>
              {!got.back && (
                <p className={styles.next}>
                  Segundo is where clients abroad pay freelancers by the second, in dollars, with no wire fees. Your account is ready: send money on
                  by link, or share your name with a client and get paid every second you work.
                </p>
              )}
            </>
          ) : empty ? (
            <>
              <h1 className={styles.h1}>This link has already been collected.</h1>
              <p className={styles.lede}>
                The money in it was collected, or {frag.from || "the sender"} took it back before anyone did. If you think that&apos;s wrong, ask{" "}
                {frag.from || "them"} to send a new link.
              </p>
              <p className={styles.proofLine}>
                <a href={explorerAddress(frag.address)} target="_blank" rel="noreferrer">
                  See the link&apos;s history on Monad
                </a>
              </p>
              <div className={styles.actions}>
                <Link href={me ? "/app" : "/"} className="btn">
                  {me ? "Open Segundo" : "What is Segundo?"}
                </Link>
              </div>
            </>
          ) : (
            <>
              <h1 className={styles.h1}>
                {from} sent you {showLocal ? local : formatUsd(usd)}.
              </h1>
              <p className={styles.lede}>
                {showLocal ? `That's ${formatUsd(usd)} in AUSD, a digital dollar by Agora, ` : "It's AUSD, a digital dollar by Agora, "}
                waiting in this link on Monad&apos;s test network. Collect it into your own account: a passkey is all you need, no app, no seed phrase, no
                fees.
              </p>
              <div className="field">
                <label htmlFor="c-cur">Show it in</label>
                <select id="c-cur" className={`input ${styles.curPick}`} value={cur} onChange={(e) => setCur(e.target.value)}>
                  {CURRENCIES.map((x) => (
                    <option key={x.code} value={x.code}>
                      {x.name} ({x.symbol})
                    </option>
                  ))}
                </select>
              </div>
              {held == null ? (
                <p className="soft" role="status">
                  Checking the link on Monad…
                </p>
              ) : isSender ? (
                <div className={styles.collect}>
                  <p className="notice">
                    <b>You sent this link.</b> Share it with the person you&apos;re paying, or take the money back into your wallet.
                  </p>
                  <button className="btn" disabled={act.busy} onClick={collect}>
                    {act.busy ? "Taking it back…" : `Take ${formatUsd(usd)} back`}
                  </button>
                </div>
              ) : !me ? (
                <SignInPanel title="Collect it with a passkey">
                  <p>Make your Segundo account on this device and {showLocal ? local : formatUsd(usd)} arrives in it about a second later.</p>
                </SignInPanel>
              ) : (
                <div className={styles.collect}>
                  <button className={`btn live ${styles.collectBtn}`} disabled={act.busy} onClick={collect}>
                    {act.busy ? "Collecting…" : `Collect ${showLocal ? local : formatUsd(usd)}`}
                  </button>
                  <p className={styles.into}>
                    Into {accountWord}, {short(me)}.{" "}
                    <button type="button" className={styles.textBtn} onClick={wallet.signOut} disabled={act.busy}>
                      Use a different account
                    </button>
                  </p>
                </div>
              )}
              <ErrorLine error={act.error} />
            </>
          )}
        </div>
        <div className={styles.preview}>{note}</div>
      </div>

      <section className={styles.how} aria-labelledby="how-title">
        <h2 id="how-title">How a Segundo link works</h2>
        <ol>
          <li>
            <b>The money is already on Monad.</b> When {frag.from || "the sender"} made this link, {formatUsd(frag.usd || usd)} moved to the
            link&apos;s own address,{" "}
            <a className="serial" href={explorerAddress(frag.address)} target="_blank" rel="noreferrer">
              {short(frag.address)}
            </a>
            . Until someone collects it, the sender can take it back.
          </li>
          <li>
            <b>The link is the key.</b> The part after the # unlocks that address. Browsers never send it to a server, so Segundo never sees
            it. Anyone holding the link can collect, so keep it to yourself.
          </li>
          <li>
            <b>Collecting takes one signature from the link, not from you.</b> Segundo&apos;s relayer pays the network fee, so neither of you
            needs MON or gas. Monad settles it in about a second.
          </li>
        </ol>
        <p className={styles.fine}>
          This runs on Monad&apos;s test network with test AUSD, so it isn&apos;t real money yet. Rates for other currencies are daily reference
          rates, shown to help you read the amount; what you hold is AUSD.
        </p>
      </section>
    </main>
  );
}

function Shell({ children, busy }: { children?: React.ReactNode; busy?: boolean }) {
  return (
    <main className={`wrap ${styles.page}`} aria-busy={busy}>
      {busy ? (
        <div className={styles.layout}>
          <div className={styles.copy}>
            <div className={`skeleton ${styles.skelLine}`} />
            <div className={`skeleton ${styles.skelLine}`} />
          </div>
          <div className={`skeleton ${styles.skel}`} />
        </div>
      ) : (
        <div className={styles.copy}>
          {children}
          <p className="soft">
            <Link href="/">Home</Link> · <Link href="/app">Your account</Link>
          </p>
        </div>
      )}
    </main>
  );
}
