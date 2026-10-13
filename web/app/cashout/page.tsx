"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { Footer } from "@/components/Footer";
import { ErrorLine, SignInPanel, busyLabel, useAction } from "@/components/ui";
import { explorerAddress, explorerTx } from "@/lib/chain";
import { gasPaused, useHealth } from "@/lib/health";
import { useDollarBalance, useProfile } from "@/lib/hooks";
import { useLive } from "@/lib/live";
import { KEEPER_ADDRESS, currency, fetchFx, formatMoney, formatUsd, rateSourceLine, toUnits, toUsd, type FxReply } from "@/lib/money";
import { sendDollars } from "@/lib/relay";
import { useWallet } from "@/lib/wallet";
import { CORRIDORS, DEMO_PARTNER, SEGUNDO_SHARE, SOURCES, SPREAD_DEFAULT, SPREAD_MAX, SPREAD_MIN, type Corridor, type SourceKey } from "./corridors";
import styles from "./cashout.module.css";

const ORDER = Object.keys(SOURCES) as SourceKey[];

function Ref({ k }: { k: SourceKey }) {
  return (
    <a href={SOURCES[k].url} target="_blank" rel="noreferrer" className={styles.ref} title={SOURCES[k].name} aria-label={`Source ${ORDER.indexOf(k) + 1}: ${SOURCES[k].name}`}>
      {ORDER.indexOf(k) + 1}
    </a>
  );
}

type Done = { hash: `0x${string}`; block: number; ms: number; usd: number; local: string; into: string; corridor: Corridor };

export default function CashOut() {
  const wallet = useWallet();
  const me = wallet.address;
  const profile = useProfile(me);
  const { rates } = useLive();
  // Where today's rate came from: the on-chain Chainlink CRE rate, or the daily reference rate (lib/money.ts).
  const [fx, setFx] = useState<FxReply | null>(null);
  useEffect(() => {
    fetchFx().then(setFx);
  }, []);
  const { balance, refresh } = useDollarBalance(me);
  const health = useHealth();
  // A cash-out returns money to its owner, so it keeps the clock-in reserve (lib/server.ts RESERVE), like /api/send does for it.
  const paused = gasPaused(health, "clockIn");
  const [code, setCode] = useState<Corridor["code"]>("PHP");
  const [picked, setPicked] = useState(false);
  const [railId, setRailId] = useState("gcash");
  const [amount, setAmount] = useState("1");
  const [spread, setSpread] = useState(SPREAD_DEFAULT);
  const [done, setDone] = useState<Done | null>(null);
  const act = useAction();

  // Start on the country the person's profile shows amounts in, until they pick one themselves.
  useEffect(() => {
    const c = CORRIDORS.find((x) => x.code === profile?.currency);
    if (!picked && c) {
      setCode(c.code);
      setRailId(c.rails[0]!.id);
    }
  }, [profile?.currency, picked]);

  const corridor = CORRIDORS.find((c) => c.code === code)!;
  const rail = corridor.rails.find((r) => r.id === railId) ?? corridor.rails[0]!;
  const cur = currency(corridor.code);
  const rate = rates?.[corridor.code] ?? null;
  const usd = Number(amount);
  const units = usd > 0 ? toUnits(usd) : 0n;
  // Worked in dollars, printed in local money at today's reference rate.
  const gross = rate && usd > 0 ? usd : null;
  const kept = gross != null ? (gross * spread) / 100 : null;
  const net = gross != null && kept != null ? gross - kept : null;
  const local = (v: number | null) => (v == null ? "—" : formatMoney(v, cur, rates));

  const problem = !(usd > 0)
    ? "Enter an amount to cash out."
    : usd < 0.01
      ? "The smallest cash-out is $0.01."
      : balance != null && units > balance
        ? `You have ${formatUsd(toUsd(balance))} in your account.`
        : null;

  const pick = (c: Corridor) => {
    setPicked(true);
    setCode(c.code);
    setRailId(c.rails[0]!.id);
    setDone(null);
  };

  const cashOut = () =>
    act.run("Cashed out", async (sent) => {
      sent();
      const landed = await sendDollars(wallet, DEMO_PARTNER, units);
      setDone({ ...landed, usd, local: local(net), into: rail.into, corridor });
      refresh();
      return landed;
    });

  const shareExample = 100 * (spread / 100) * SEGUNDO_SHARE;

  return (
    <>
      <main className={`wrap ${styles.page}`}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Cash out</p>
          <h1 className={styles.h1}>Cash out to local money</h1>
          <p className={styles.lead}>
            Your pay lands as AUSD, a digital US dollar. Most people need pesos, naira, shillings, rupees or reais in a bank account or a mobile wallet.
            Here is exactly what that looks like with Segundo: today&apos;s rate, who does the last step, what it costs and how long it takes.
          </p>
          <p className={styles.testnet}>
            <b>On testnet this is a simulation.</b> Cashing out sends your test AUSD to Segundo&apos;s demo partner wallet; no real money moves and nothing
            reaches a bank. No partner is signed yet.
          </p>
        </header>

        <div className={styles.layout}>
          <section className={styles.form} aria-labelledby="where">
            <h2 id="where" className={styles.legend}>
              Where should the money go?
            </h2>
            <div className={styles.corridors} role="group" aria-label="Country">
              {CORRIDORS.map((c) => {
                const k = currency(c.code);
                return (
                  <button
                    key={c.code}
                    type="button"
                    className={styles.corridor}
                    aria-pressed={c.code === code}
                    onClick={() => pick(c)}
                    style={{ "--ink-c": k.ink, "--ink-n": k.inkNight } as CSSProperties}
                  >
                    <b>{c.country}</b>
                    <span>
                      {k.symbol} {k.name}
                    </span>
                    <span>{c.rails.map((r) => r.label).join(" or ")}</span>
                  </button>
                );
              })}
            </div>

            {corridor.rails.length > 1 && (
              <fieldset className={styles.rails}>
                <legend>Into</legend>
                {corridor.rails.map((r) => (
                  <label key={r.id} className={styles.rail}>
                    <input
                      type="radio"
                      name="rail"
                      checked={r.id === rail.id}
                      onChange={() => {
                        setRailId(r.id);
                        setDone(null);
                      }}
                    />
                    {r.label}
                  </label>
                ))}
              </fieldset>
            )}

            <div className="field">
              <label htmlFor="cash-amount">Amount</label>
              <div className={styles.money}>
                <span aria-hidden>$</span>
                <input
                  id="cash-amount"
                  className="input"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setDone(null);
                  }}
                />
              </div>
              <span className="hint">
                {me ? (
                  <>
                    In your account: {balance == null ? "…" : formatUsd(toUsd(balance))}.{" "}
                    {balance != null && balance > 0n && (
                      <button type="button" className={styles.inlineBtn} onClick={() => setAmount(toUsd(balance).toFixed(2))}>
                        Cash out all of it
                      </button>
                    )}
                  </>
                ) : (
                  "In AUSD, from your Segundo account."
                )}
              </span>
            </div>

            <div className="field">
              <label htmlFor="cash-spread">
                Partner&apos;s spread <span className={styles.tag}>Assumption</span>
              </label>
              <div className={styles.slider}>
                <input
                  id="cash-spread"
                  type="range"
                  min={SPREAD_MIN}
                  max={SPREAD_MAX}
                  step={0.25}
                  value={spread}
                  onChange={(e) => setSpread(Number(e.target.value))}
                  aria-valuetext={`${spread.toFixed(2)} percent`}
                />
                <output htmlFor="cash-spread" className="denom">
                  {spread.toFixed(2)}%
                </output>
              </div>
              <span className="hint">
                Local partners build their cost into the rate they pay out at instead of listing a fee, and none publishes one figure per corridor, so
                this is our assumption, not a quote. Move it to see what changes.
              </span>
            </div>
          </section>

          <aside className={styles.side} aria-label="Your quote">
            <div className={styles.stub} style={{ "--ink-c": cur.ink, "--ink-n": cur.inkNight } as CSSProperties}>
              <p className={styles.stubTitle}>
                <span>Cash-out quote</span>
                <span className="serial">{corridor.code}</span>
              </p>
              <dl className={styles.quote}>
                <dt>Today&apos;s rate</dt>
                <dd>{rate ? `$1 = ${formatMoney(1, { ...cur, digits: 2 }, rates)}` : "Loading…"}</dd>
                <dt>{formatUsd(usd > 0 ? usd : 0)} at that rate</dt>
                <dd>{local(gross)}</dd>
                <dt>Partner&apos;s spread ({spread.toFixed(2)}%, assumed)</dt>
                <dd>{kept == null ? "—" : `− ${local(kept)}`}</dd>
                <dt className={styles.total}>Would arrive in {rail.into}</dt>
                <dd className={`${styles.total} denom`}>≈ {local(net)}</dd>
              </dl>
              <dl className={styles.facts}>
                <dt>Paid out by</dt>
                <dd>{corridor.partner}</dd>
                <dt>Arrives</dt>
                <dd>{corridor.arrival}</dd>
                <dt>Segundo&apos;s fee</dt>
                <dd>None on top. On mainnet Segundo would earn a share of the partner&apos;s spread, shown here before you confirm.</dd>
              </dl>
              <p className={styles.small}>
                {rateSourceLine(corridor.code, fx)}
                {fx?.sources[corridor.code]?.source === "chainlink-cre" ? (
                  <>
                    {" "}(
                    <a href={explorerAddress(KEEPER_ADDRESS)} target="_blank" rel="noreferrer">
                      SegundoKeeper
                    </a>
                    ).
                  </>
                ) : (
                  <>
                    <Ref k="er" />.
                  </>
                )}{" "}
                {corridor.note} {corridor.src.map((k) => <Ref key={k} k={k} />)}
              </p>
            </div>

            {!me ? (
              <SignInPanel title="Sign in to try a cash-out">
                <p>
                  {wallet.accounts === "mera"
                    ? "Sign in with your passkey; nothing else is needed. On testnet nothing real moves."
                    : "Any Segundo account works: a passkey, email or a practice wallet. On testnet nothing real moves."}
                </p>
              </SignInPanel>
            ) : done ? (
              <div className={styles.receipt} role="status">
                <p className={styles.receiptBig}>
                  <span className="denom">{done.local}</span> would arrive in {done.into} via a local partner.
                </p>
                <p>
                  On testnet this is simulated: your {formatUsd(done.usd)} in test AUSD went to Segundo&apos;s{" "}
                  <a href={explorerAddress(DEMO_PARTNER)} target="_blank" rel="noreferrer">
                    demo partner wallet
                  </a>
                  . Landed in {(done.ms / 1000).toFixed(2)} s,{" "}
                  <a className="serial" href={explorerTx(done.hash)} target="_blank" rel="noreferrer">
                    block {done.block.toLocaleString("en-US")}
                  </a>
                  . No gas, no fee.
                </p>
                <button type="button" className="btn small" onClick={() => setDone(null)}>
                  Cash out again
                </button>
              </div>
            ) : (
              <div className={styles.go}>
                <button type="button" className="btn primary" disabled={!!problem || act.busy || paused || !rate} onClick={cashOut}>
                  {busyLabel(act.phase, usd > 0 ? `Cash out ${formatUsd(usd)} (simulated)` : "Cash out (simulated)")}
                </button>
                {problem && <span className={styles.why}>{problem}</span>}
                {paused && !problem && <span className={styles.why}>The relayer is short of test MON, so transfers are paused for a moment. Your balance is unchanged.</span>}
                <p className="soft">
                  You sign one transfer of test AUSD to the demo partner, <span className="serial">{DEMO_PARTNER.slice(0, 6)}…{DEMO_PARTNER.slice(-4)}</span>. Segundo
                  pays the gas.
                </p>
                <ErrorLine error={act.error} />
              </div>
            )}
          </aside>
        </div>

        <section className={styles.section} aria-labelledby="mainnet">
          <h2 id="mainnet" className={styles.h2}>
            How it works on mainnet
          </h2>
          <ol className={styles.steps}>
            <li>
              <b>You pick the country, the account and the amount,</b> and see the rate you&apos;ll get and the amount that will arrive before you confirm.
              The quote is held for the moment you sign.
            </li>
            <li>
              <b>You sign one transfer of AUSD to the partner,</b> exactly as on testnet: gasless, from the same account your pay lands in.
            </li>
            <li>
              <b>The partner pays out on the local rail,</b> {corridor.code === "BRL" ? "Pix" : corridor.code === "KES" ? "M-Pesa" : corridor.code === "INR" ? "UPI or IMPS" : corridor.code === "NGN" ? "NIP" : "InstaPay"}{" "}
              in {corridor.country}, from its own local currency balance. It is the licensed company in the country and does the identity checks local law
              asks for.
            </li>
            <li>
              <b>Segundo earns a share of the partner&apos;s spread.</b> No fee on top, and nothing from the freelancer otherwise: the share comes out of
              the margin the partner already charges.
            </li>
          </ol>
        </section>

        <section className={styles.section} aria-labelledby="earns">
          <h2 id="earns" className={styles.h2}>
            What Segundo earns: revenue line 3
          </h2>
          <div className={styles.cols}>
            <p>
              Clients pay Segundo 1% of what they fund, and get 1% of the unspent part back when a tab closes (line 1). Reserve yield on budgets waiting in
              tabs is line 2. Cash-out is line 3: a share of the spread the payout partner keeps, agreed with each partner.
            </p>
            <p>
              With a spread of <b>{spread.toFixed(2)}%</b> and Segundo&apos;s share at <b>{Math.round(SEGUNDO_SHARE * 100)}%</b> of it (both assumptions,
              since no partner has signed), every $100 cashed out earns Segundo <b className="denom">{formatUsd(shareExample)}</b>. The partner keeps{" "}
              {formatUsd(100 * (spread / 100) - shareExample)} and the freelancer gets the rest, about {formatUsd(100 - 100 * (spread / 100))}.{" "}
              <Link href="/business">The whole business model</Link>.
            </p>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="today">
          <h2 id="today" className={styles.h2}>
            The bar: what people pay today
          </h2>
          <div className={styles.bars}>
            <Bar label="Sending $200, global average" value={6.36} />
            <Bar label="Into a bank account" value={7.86} />
            <Bar label="Into a mobile money wallet" value={3.92} />
            <Bar label="Cash-out spread on this page (assumed)" value={spread} ours />
          </div>
          <p className="soft">
            Average total cost of sending money, from the World Bank&apos;s Remittance Prices Worldwide for the third quarter of 2025
            <Ref k="rpw" />. A dollar balance that is already digital skips the sending bank and the card network; only the last step into local money is
            left, and that is the step a cash-out partner prices.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="sources">
          <h2 id="sources" className={styles.h2}>
            Sources
          </h2>
          <ol className={styles.sources}>
            {ORDER.map((k) => (
              <li key={k}>
                <a href={SOURCES[k].url} target="_blank" rel="noreferrer">
                  {SOURCES[k].name}
                </a>
              </li>
            ))}
          </ol>
          <p className="soft">
            The partner&apos;s spread and Segundo&apos;s share of it are assumptions, labelled as such wherever they appear. The exchange rate is the one
            Segundo&apos;s Chainlink CRE workflow last posted on Monad (a daily reference rate when that is over 6 hours old), shown to people and never
            used to move money.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}

function Bar({ label, value, ours }: { label: string; value: number; ours?: boolean }) {
  return (
    <div className={`${styles.bar} ${ours ? styles.ours : ""}`}>
      <span>{label}</span>
      <span className={styles.track} aria-hidden>
        <span style={{ width: `${Math.min(100, (value / 8) * 100)}%` }} />
      </span>
      <b className="denom">{value.toFixed(2)}%</b>
    </div>
  );
}
