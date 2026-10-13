"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { Footer } from "@/components/Footer";
import { explorerAddress, explorerTx } from "@/lib/chain";
import type { Cre } from "@/lib/cre";
import { useLive } from "@/lib/live";
import { KEEPER_ADDRESS, ago, currency, fetchFx, formatMoney, formatUsd, parseAmount, rateSourceLine, toUsd, type FxReply } from "@/lib/money";
import { useWallet } from "@/lib/wallet";
import styles from "./send.module.css";

/** Where people send to, by the currency they spend. The ink is the currency's own (lib/money.ts). */
const PLACES = [
  { code: "PHP", country: "Philippines" },
  { code: "NGN", country: "Nigeria" },
  { code: "INR", country: "India" },
  { code: "KES", country: "Kenya" },
  { code: "BRL", country: "Brazil" },
  { code: "PKR", country: "Pakistan" },
  { code: "IDR", country: "Indonesia" },
  { code: "MXN", country: "Mexico" },
  { code: "EUR", country: "Euro area" },
  { code: "GBP", country: "United Kingdom" },
  { code: "SGD", country: "Singapore" },
  { code: "USD", country: "United States" },
] as const;

type Mode = "link" | "contact" | "address";
const WAYS: { mode: Mode; title: string; line: string }[] = [
  { mode: "link", title: "By link", line: "No wallet needed. They open the link and collect it with a passkey." },
  { mode: "contact", title: "To an email", line: "It waits in a wallet made for that email until they sign in." },
  { mode: "address", title: "To an address", line: "Straight to any wallet on Monad." },
];

/** The send sheet on /app reads these (components/SendSheet.tsx), so "Send now" opens it on the same way and currency. */
const MODE_KEY = "segundo.send.mode";
const CUR_KEY = "segundo.send.cur";

/** World Bank, Remittance Prices Worldwide, Q3 2025: global average total cost of sending $200. */
const RPW_AVERAGE = 6.36;
const RPW = {
  name: "World Bank, Remittance Prices Worldwide, Issue 54 (Q3 2025)",
  url: "https://remittanceprices.worldbank.org/sites/default/files/2026-04/RPW_main_report_and_annex_Q325.pdf",
};

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export default function SendAbroad() {
  const wallet = useWallet();
  const { rates, head } = useLive();
  const [code, setCode] = useState<string>("PHP");
  const [amount, setAmount] = useState("100");
  const [mode, setMode] = useState<Mode>("link");
  const [fx, setFx] = useState<FxReply | null>(null);
  const [cre, setCre] = useState<Cre | null>(null);

  useEffect(() => {
    try {
      const c = localStorage.getItem(CUR_KEY);
      if (c && PLACES.some((p) => p.code === c)) setCode(c);
      const m = localStorage.getItem(MODE_KEY);
      if (m === "contact" || m === "address" || m === "link") setMode(m);
    } catch {}
    fetchFx().then(setFx);
    fetch("/api/cre")
      .then((r) => (r.ok ? (r.json() as Promise<Cre>) : null))
      .then(setCre)
      .catch(() => {});
  }, []);

  const cur = currency(code);
  const place = PLACES.find((p) => p.code === code)!;
  const parsed = parseAmount(amount);
  const usd = parsed.units == null ? 0 : toUsd(parsed.units);
  const hasRate = code === "USD" || !!rates?.[code];
  const receive = hasRate ? formatMoney(usd, cur, rates) : formatUsd(usd);
  const usual = (usd * RPW_AVERAGE) / 100;
  const src = fx?.sources[code];
  const reportTx = src?.source === "chainlink-cre" ? src.tx : null;
  const ink = { "--c": cur.ink, "--c-night": cur.inkNight } as CSSProperties;

  const go = () => {
    store(MODE_KEY, mode);
    store(CUR_KEY, code);
  };

  return (
    <>
      <main className={`wrap ${styles.page}`}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Send dollars abroad</p>
          <h1 className={styles.h1}>Send dollars home in about a second.</h1>
          <p className={styles.lead}>
            Pay family, a freelancer or a supplier in another country in digital US dollars. They get it in about a second, see it in their own currency,
            and need nothing but a link to collect it. You sign with a passkey; there is no fee to send.
          </p>
        </header>

        <section className={styles.calc} aria-labelledby="calc-title">
          <h2 id="calc-title" className="visually-hidden">
            Work out a transfer
          </h2>
          <div className={styles.form}>
            <fieldset className={styles.places}>
              <legend className={styles.legend}>Where do they live?</legend>
              <div className={styles.placeGrid}>
                {PLACES.map((p) => {
                  const c = currency(p.code);
                  return (
                    <button
                      key={p.code}
                      type="button"
                      className={styles.place}
                      aria-pressed={p.code === code}
                      onClick={() => setCode(p.code)}
                      style={{ "--c": c.ink, "--c-night": c.inkNight } as CSSProperties}
                    >
                      <b>{p.country}</b>
                      <span>
                        {c.name} ({c.symbol})
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="field">
              <label htmlFor="send-amt">You send, in US dollars</label>
              <div className={styles.money}>
                <span aria-hidden>$</span>
                <input
                  id="send-amt"
                  className="input"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-describedby="send-quote"
                />
              </div>
              {amount && parsed.problem && <span className="hint">{parsed.problem}</span>}
            </div>

            <fieldset className={styles.ways}>
              <legend className={styles.legend}>How should it reach them?</legend>
              <div className={styles.wayGrid}>
                {WAYS.map((w) => (
                  <button key={w.mode} type="button" className={styles.way} aria-pressed={w.mode === mode} onClick={() => setMode(w.mode)}>
                    <b>{w.title}</b>
                    <span>{w.line}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <aside className={styles.side} aria-label="What they receive">
            <div className={styles.stub} style={ink} id="send-quote" aria-live="polite">
              <p className={styles.stubTitle}>
                <span>They receive about</span>
                <span className="serial">{code}</span>
              </p>
              <p className={`denom ${styles.receive}`}>{receive}</p>
              <dl className={styles.facts}>
                <dt>You send</dt>
                <dd>{formatUsd(usd)} in AUSD</dd>
                <dt>Fee to send</dt>
                <dd>$0.00</dd>
                <dt>Network cost</dt>
                <dd>Paid by Segundo</dd>
                <dt>Arrives</dt>
                <dd>In about a second</dd>
                {code !== "USD" && (
                  <>
                    <dt>Rate</dt>
                    <dd>{hasRate ? `$1 = ${formatMoney(1, { ...cur, digits: 2 }, rates)}` : "Loading…"}</dd>
                  </>
                )}
              </dl>
              {code !== "USD" && (
                <p className={styles.source}>
                  {rateSourceLine(code, fx)}
                  {reportTx ? (
                    <>
                      {" "}
                      (
                      <a href={explorerTx(reportTx)} target="_blank" rel="noreferrer">
                        the report
                      </a>
                      ).
                    </>
                  ) : (
                    "."
                  )}{" "}
                  It shows what they can expect; the money itself moves as dollars.
                </p>
              )}
              <p className={styles.compare}>
                Sending $200 abroad the usual way costs {RPW_AVERAGE}% on average
                <a href={RPW.url} target="_blank" rel="noreferrer" className={styles.ref} title={RPW.name} aria-label={`Source: ${RPW.name}`}>
                  1
                </a>
                {usd > 0 ? `; at that rate, ${formatUsd(usual)} of your ${formatUsd(usd)}` : ""}.
              </p>
            </div>
            <Link href="/app?send=1" className={`btn primary ${styles.go}`} onClick={go}>
              Send now
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M4 12h15M13 6l6 6-6 6" />
              </svg>
            </Link>
            <p className={styles.goNote}>
              {wallet.address
                ? `Opens the send sheet in your account, set to ${WAYS.find((w) => w.mode === mode)!.title.toLowerCase()} and ${cur.name.toLowerCase()}.`
                : "You'll sign in first: a passkey is enough, no app to install."}{" "}
              Need dollars first?{" "}
              <Link href="/app?add=1" className={styles.inline}>
                Add money
              </Link>
              .
            </p>
          </aside>
        </section>

        <section className={styles.section} aria-labelledby="three">
          <h2 id="three" className={styles.h2}>
            Three ways to reach them
          </h2>
          <div className={styles.threeGrid}>
            <article className={styles.card}>
              <h3>By link</h3>
              <p className={styles.cardLead}>For someone who has never used a wallet.</p>
              <p>
                Segundo puts the money in a fresh key that lives only inside the link, after the #, which never reaches our server. Send it on WhatsApp, by
                text or as a QR code. Whoever opens it first collects, and until they do you can take the money back.
              </p>
            </article>
            <article className={styles.card}>
              <h3>To an email</h3>
              <p className={styles.cardLead}>For someone you know by their email address.</p>
              <p>
                If they already use Segundo with that email, it lands in their account. If not, a wallet is made for that email (Privy holds it) and the
                money waits there until they sign in with the same address.
              </p>
            </article>
            <article className={styles.card}>
              <h3>To an address</h3>
              <p className={styles.cardLead}>For someone with a wallet or an exchange account on Monad.</p>
              <p>
                Paste their Monad address and send. It is an ordinary AUSD transfer on Monad, so any wallet or exchange that supports Monad can receive
                it.
              </p>
            </article>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="how">
          <h2 id="how" className={styles.h2}>
            How it works
          </h2>
          <ol className={styles.steps}>
            <li>
              <span className={`denom ${styles.n}`}>1</span>
              <div>
                <h3>Sign in with a passkey</h3>
                <p>
                  Face, fingerprint or screen lock, the way you unlock your phone. Your Segundo key is derived from the passkey with Mera, so there is no
                  seed phrase to write down and no app to install.
                </p>
              </div>
            </li>
            <li>
              <span className={`denom ${styles.n}`}>2</span>
              <div>
                <h3>Pay in digital dollars</h3>
                <p>
                  The money is AUSD, Agora&apos;s digital dollar, which tracks the US dollar one to one. You type an amount in dollars and see what it
                  is worth where they live.
                </p>
              </div>
            </li>
            <li>
              <span className={`denom ${styles.n}`}>3</span>
              <div>
                <h3>Monad settles it in about a second</h3>
                <p>
                  Monad makes a new block every few hundred milliseconds and finalises it moments later, so the transfer is done before you put the phone
                  down.
                  {head ? (
                    <>
                      {" "}
                      Right now it is on block <span className="serial">{head.number.toLocaleString("en-US")}</span>.
                    </>
                  ) : null}
                </p>
              </div>
            </li>
            <li>
              <span className={`denom ${styles.n}`}>4</span>
              <div>
                <h3>No gas, no fee to send</h3>
                <p>
                  You sign; Segundo&apos;s relayer submits the transaction and pays the network cost. You never need MON, Monad&apos;s own token, and the
                  full amount arrives.
                </p>
              </div>
            </li>
          </ol>
        </section>

        <section className={`${styles.section} ${styles.claim}`} aria-labelledby="claim">
          <div className={styles.claimText}>
            <h2 id="claim" className={styles.h2}>
              What they see
            </h2>
            <ol className={styles.claimSteps}>
              <li>
                <b>They open the link</b> on any phone. It shows who sent it and the amount in their own currency, read from Monad, not from the message.
              </li>
              <li>
                <b>They make a passkey</b> with one tap, or sign in with email. That makes their Segundo account.
              </li>
              <li>
                <b>The money moves into their account</b> in about a second. Collecting takes one signature from the link&apos;s key, not from them, and
                Segundo pays the network cost.
              </li>
              <li>
                <b>They keep it, send it on or cash out.</b> AUSD holds its dollar value. To spend it locally they can{" "}
                <Link href="/cashout" className={styles.inline}>
                  cash out to pesos, naira, rupees, shillings or reais
                </Link>{" "}
                through a local partner (simulated on testnet).
              </li>
            </ol>
          </div>
          <figure className={styles.phone} style={ink} aria-hidden>
            <div className={styles.phoneScreen}>
              <p className={styles.phoneFrom}>Ana sent you</p>
              <p className={`denom ${styles.phoneAmount}`}>{receive}</p>
              <p className={styles.phoneUsd}>{formatUsd(usd)} in AUSD, waiting in this link</p>
              <span className={styles.phoneBtn}>Collect with a passkey</span>
              <p className={styles.phoneFine}>No app, no seed phrase, no fee.</p>
            </div>
            <figcaption>
              The page they open, for someone in {/^(United|Euro|Philippines)/.test(place.country) ? `the ${place.country.replace("Euro", "euro")}` : place.country}.
            </figcaption>
          </figure>
        </section>

        <section className={styles.section} aria-labelledby="rates">
          <h2 id="rates" className={styles.h2}>
            The rate comes from Monad, not from us
          </h2>
          <p className={styles.prose}>
            Segundo runs a Chainlink CRE workflow. It fetches the dollar rate from three public sources, takes the median and posts it to
            Segundo&apos;s keeper contract on Monad with a timestamp. On testnet it runs in Chainlink&apos;s CRE simulator every two hours, not yet on a
            live network of nodes, so the app only trusts reports sent by Segundo&apos;s own CRE key. This page, the cash-out quote and every income
            statement read that on-chain rate while it is less than six hours old, and say so.
          </p>
          <div className={styles.rateSheet}>
            <table className={styles.rateTable}>
              <caption className="visually-hidden">Exchange rates posted on Monad by the Chainlink workflow</caption>
              <thead>
                <tr>
                  <th scope="col">Currency</th>
                  <th scope="col">Per US dollar</th>
                  <th scope="col">Agreed</th>
                </tr>
              </thead>
              <tbody>
                {(cre?.rates.length ? cre.rates : []).map((r) => {
                  const c = currency(r.cur);
                  return (
                    <tr key={r.cur} style={{ "--c": c.ink, "--c-night": c.inkNight } as CSSProperties}>
                      <th scope="row">
                        <span className={styles.chip} /> {c.name}
                      </th>
                      <td className="denom">
                        {c.symbol}
                        {(r.rateE6 / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                      </td>
                      <td>{ago(Date.now() / 1000 - r.at)}</td>
                    </tr>
                  );
                })}
                {!cre && (
                  <tr>
                    <td colSpan={3} className={styles.loadingRow}>
                      Reading the keeper contract on Monad…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <dl className={styles.keeper}>
              <dt>Newest report</dt>
              <dd>
                {cre?.lastBlock ? (
                  <a className="serial" href={cre.lastTx ? explorerTx(cre.lastTx) : explorerAddress(KEEPER_ADDRESS)} target="_blank" rel="noreferrer">
                    block {cre.lastBlock.toLocaleString("en-US")}
                  </a>
                ) : (
                  "—"
                )}
                {cre?.lastAt ? `, ${ago(Date.now() / 1000 - cre.lastAt)}` : ""}
              </dd>
              <dt>Reports on chain</dt>
              <dd>{cre ? cre.reports.toLocaleString("en-US") : "—"}</dd>
              <dt>Paid out by the same reports</dt>
              <dd>
                {cre ? formatUsd(toUsd(BigInt(cre.paidTotal))) : "—"}
                {cre?.tabsSettledTotal != null ? ` across ${cre.tabsSettledTotal} tab settlements` : ""}, including our demo studios
              </dd>
              <dt>Keeper contract</dt>
              <dd>
                <a className="serial" href={explorerAddress(KEEPER_ADDRESS)} target="_blank" rel="noreferrer">
                  {KEEPER_ADDRESS.slice(0, 6)}…{KEEPER_ADDRESS.slice(-4)}
                </a>{" "}
                (<a href="/api/cre">raw data</a>)
              </dd>
            </dl>
          </div>
        </section>

        <section className={`${styles.section} ${styles.money2}`} aria-labelledby="in">
          <div>
            <h2 id="in" className={styles.h2}>
              Getting dollars in
            </h2>
            <p className={styles.prose}>
              Every Segundo account has an address on Monad. On testnet, take 25 test AUSD from the faucet in one tap. On mainnet, a business would get
              AUSD from Agora by bank wire, and anyone else would buy it on an exchange that supports Monad and withdraw it to that address.
            </p>
          </div>
          <div className={styles.inActions}>
            <Link href="/app?add=1" className="btn">
              Add money
            </Link>
            <Link href="/cashout" className="btn quiet">
              Cash out to local money
            </Link>
          </div>
        </section>

        <p className={styles.testnet}>
          <b>This is Monad&apos;s test network.</b> Segundo sends Agora&apos;s test AUSD, which isn&apos;t real money. Rates are shown to people
          and never used to move money: the money itself always moves as dollars.
        </p>
      </main>
      <Footer />
    </>
  );
}
