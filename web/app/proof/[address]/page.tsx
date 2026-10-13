"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { RequestNotice, ShareDetails, VerifiedDetails, VerifierPanel } from "@/components/Disclosure";
import { Footer } from "@/components/Footer";
import { nameOf, useHistoryFeed, useNames } from "@/components/PayHistory";
import { DEMO_CLIENTS, DEMO_FREELANCERS } from "@/lib/demo";
import type { VerifiedDisclosure } from "@/lib/disclose";
import type { HistoryItem } from "@/lib/envio";
import { TILL, explorerAddress, explorerTx } from "@/lib/chain";
import { mulberry32, seedOf, wavePath } from "@/lib/guilloche";
import { useProfile } from "@/lib/hooks";
import { useLive } from "@/lib/live";
import { currency, formatDuration, formatFee, formatMoney, formatUsd, toUsd, type Currency, type Rates } from "@/lib/money";
import { canSeal, hasSealedDetails, unsealDetails, type SealedDetails } from "@/lib/seal";
import { shortAddress } from "@/lib/tabs";
import { useWallet } from "@/lib/wallet";
import styles from "./statement.module.css";

type Period = "30d" | "90d" | "12m" | "all";
const PERIODS: { key: Period; label: string; days: number | null }[] = [
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
  { key: "12m", label: "Last 12 months", days: 365 },
  { key: "all", label: "All time", days: null },
];
/** Block of the Till contract's deployment: the statement reads every event from here on. */
const FROM_BLOCK = 68_119_428;
/** Payout lines shown on screen before "Show all"; print always shows every line. */
const FIRST_LINES = 40;

const day = (t: number) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const stamp = (t: number) =>
  `${new Date(t * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
const isoDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const isoMonth = (t: number) => new Date(t * 1000).toISOString().slice(0, 7);
const demoNames = new Set([...DEMO_CLIENTS, ...DEMO_FREELANCERS].map((d) => d.address.toLowerCase()));

export default function Statement() {
  const params = useParams<{ address: string }>();
  const address = useMemo<Address | null>(() => (isAddress(params.address, { strict: false }) ? getAddress(params.address) : null), [params.address]);
  if (!address) return <Missing />;
  return <StatementFor address={address} />;
}

function StatementFor({ address }: { address: Address }) {
  const { data, error } = useHistoryFeed(address);
  const profile = useProfile(address);
  const { rates, ratesUpdated } = useLive();
  // A minute clock is enough for a statement (and spares hundreds of rows a re-render every tick).
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(t);
  }, []);
  const wallet = useWallet();
  const [period, setPeriod] = useState<Period>("90d");
  const [showAll, setShowAll] = useState(false);
  const [url, setUrl] = useState("");
  const [generated, setGenerated] = useState(0);
  // A verifier asking for details (?request=1, or a reply link), and what their browser has opened (components/Disclosure.tsx).
  const [asking, setAsking] = useState(false);
  const [verified, setVerified] = useState<VerifiedDisclosure | null>(null);

  // The period lives in the link, so a printed QR code opens the same statement.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const p = q.get("period") as Period | null;
    if (p && PERIODS.some((x) => x.key === p)) setPeriod(p);
    if (q.get("request") === "1" || /(^|[#&])reply=/.test(window.location.hash)) setAsking(true);
  }, []);
  useEffect(() => {
    const u = new URL(window.location.href);
    const request = u.searchParams.get("request") === "1";
    u.search = period === "90d" ? "" : `?period=${period}`;
    // The shared link and QR code never carry the request flag or a key; the address bar keeps the request flag.
    const shared = new URL(u);
    shared.hash = "";
    if (request) u.searchParams.set("request", "1");
    window.history.replaceState(null, "", u);
    setUrl(shared.toString());
  }, [period]);
  useEffect(() => {
    if (data) setGenerated(Math.floor(Date.now() / 1000));
  }, [data]);

  const cur = currency(profile?.currency || "USD");
  const days = PERIODS.find((p) => p.key === period)!.days;
  const since = days == null ? 0 : now - days * 86_400;

  const income = useMemo(
    () => (data?.items ?? []).filter((i) => i.kind === "paid" && i.role === "freelancer" && i.time >= since && i.amount),
    [data, since],
  );
  const shifts = useMemo(() => clockTime(data?.items ?? [], since, now), [data, since, now]);
  const names = useNames(income.map((i) => i.counterparty).filter((a): a is Address => !!a));
  const total = income.reduce((s, i) => s + BigInt(i.amount!), 0n);
  const clients = useMemo(() => byClient(income), [income]);
  // Tabs this account funded: not income, so they stay out of the totals, but a client looking up their own
  // statement should see where their money went rather than an empty page.
  const funded = useMemo(() => asClient(data?.items ?? [], since), [data, since]);
  const bars = useMemo(() => buckets(income, since, now), [income, since, now]);
  const owner = !!wallet.address && wallet.address.toLowerCase() === address.toLowerCase();
  const first = income.at(-1)?.time;
  const periodFrom = days == null ? (first ?? now) : since;
  const name = profile?.name || "Unnamed Segundo account";

  return (
    <main className={`wrap ${styles.page}`}>
      <style media="print">{PRINT}</style>
      <div className={styles.tools}>
        <Link href="/proof" className={styles.back}>
          Check another statement
        </Link>
        <div className={styles.toolButtons}>
          <button className="btn small quiet" onClick={() => navigator.clipboard?.writeText(url)}>
            Copy link
          </button>
          <button className="btn small primary" onClick={() => window.print()}>
            Print or save as PDF
          </button>
        </div>
      </div>

      {asking && <VerifierPanel address={address} onVerified={setVerified} />}

      <article className={styles.sheet} style={{ ["--cur" as string]: cur.ink, ["--cur-night" as string]: cur.inkNight }} aria-labelledby="statement-title">
        <Border seed={address} />
        <header className={styles.top}>
          <div className={styles.titleBlock}>
            <p className={styles.kicker}>Segundo</p>
            <h1 id="statement-title">Income statement</h1>
            <p className={styles.period}>
              {PERIODS.find((p) => p.key === period)!.label}: {day(periodFrom)} to {day(now)}
            </p>
          </div>
          <dl className={styles.who}>
            <div>
              <dt>Name on Segundo</dt>
              <dd className={styles.name}>{profile ? name : <span className={`skeleton ${styles.lineSkel}`} />}</dd>
            </div>
            {profile?.place && (
              <div>
                <dt>Based in</dt>
                <dd>{profile.place}</dd>
              </div>
            )}
            <div>
              <dt>Thinks in</dt>
              <dd>
                {cur.name} ({cur.code})
              </dd>
            </div>
            <div>
              <dt>Account</dt>
              <dd>
                <a className={`serial ${styles.addr}`} href={explorerAddress(address)} target="_blank" rel="noreferrer">
                  {address}
                </a>
              </dd>
            </div>
          </dl>
          {demoNames.has(address.toLowerCase()) && (
            <p className={styles.demoNote}>
              This account is one of Segundo&apos;s demo freelancers, run by a script on testnet so there is always live pay to look at. Its clients
              are our demo studios and the visitors who open tabs to it.
            </p>
          )}
        </header>

        <Sealed address={address} owner={owner} wallet={wallet} />
        {owner && canSeal(wallet) ? <ShareDetails address={address} wallet={wallet} block={data ? data.head : null} /> : <RequestNotice />}
        {verified && <VerifiedDetails v={verified} />}

        <div className={styles.periods} role="radiogroup" aria-label="Period">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              role="radio"
              aria-checked={period === p.key}
              className={period === p.key ? styles.on : undefined}
              onClick={() => {
                setPeriod(p.key);
                setShowAll(false);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {!data ? (
          error ? (
            <p className="notice error">{error}</p>
          ) : (
            <div className={`skeleton ${styles.bodySkel}`} aria-busy="true" />
          )
        ) : (
          <>
            {data.source === "rpc" && (
              <p className="notice">
                Envio HyperRPC is out of reach right now, so the lines below cover only the last few minutes, read from Monad&apos;s public RPC. Reload in a
                minute for the full statement.
              </p>
            )}
            <section className={styles.totals} aria-label="Totals">
              <div className={styles.total}>
                <p className={styles.label}>Total received</p>
                <p className={`denom ${styles.big}`}>{local(toUsd(total), cur, rates)}</p>
                {cur.code !== "USD" && (
                  <p className={styles.sub}>
                    <b>{formatUsd(toUsd(total))}</b> in AUSD, a US dollar stablecoin
                  </p>
                )}
              </div>
              <dl className={styles.facts}>
                <div>
                  <dt>Payouts</dt>
                  <dd className="denom">{income.length.toLocaleString("en-US")}</dd>
                </div>
                <div>
                  <dt>Clients</dt>
                  <dd className="denom">{clients.length}</dd>
                </div>
                <div>
                  <dt>On the clock</dt>
                  <dd className="denom">{shifts.seconds > 0 ? formatDuration(shifts.seconds) : "—"}</dd>
                </div>
                <div>
                  <dt>Average an hour</dt>
                  <dd className="denom">{shifts.seconds >= 60 ? local(toUsd(total) / (shifts.seconds / 3600), cur, rates) : "—"}</dd>
                </div>
              </dl>
            </section>

            {income.length === 0 ? (
              <p className={styles.empty}>No pay received in this period.{period !== "all" && " Try a longer period."}</p>
            ) : (
              <>
                <section className={styles.section} aria-labelledby="by-time">
                  <h2 id="by-time">{bars.byDay ? "Received by day" : "Received by month"}</h2>
                  <Bars bars={bars.rows} byDay={bars.byDay} cur={cur} rates={rates} />
                </section>

                <section className={styles.section} aria-labelledby="by-client">
                  <h2 id="by-client">By client</h2>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Client</th>
                        <th scope="col">Tabs</th>
                        <th scope="col">Payouts</th>
                        <th scope="col" className={styles.num}>
                          Received
                        </th>
                        <th scope="col" className={styles.num}>
                          Share
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {clients.map((c) => (
                        <tr key={c.address}>
                          <td data-label="Client">
                            {names[c.address.toLowerCase()]?.name ? (
                              <>
                                <span className={styles.client}>{nameOf(names, c.address)}</span>
                                {names[c.address.toLowerCase()]?.place && <span className="soft"> · {names[c.address.toLowerCase()].place}</span>}
                                {demoNames.has(c.address.toLowerCase()) && <span className={styles.demo}>demo studio</span>}
                                <a className={`serial ${styles.small}`} href={explorerAddress(c.address)} target="_blank" rel="noreferrer">
                                  {shortAddress(c.address)}
                                </a>
                              </>
                            ) : (
                              // No name on Segundo: the address is the name, printed once.
                              <a className={`serial ${styles.client}`} href={explorerAddress(c.address)} target="_blank" rel="noreferrer">
                                {shortAddress(c.address)}
                              </a>
                            )}
                          </td>
                          <td data-label="Tabs">
                            {c.tabs.map((t) => (
                              <Link key={t} href={`/tab/${t}`} className={`serial ${styles.tabNo}`}>
                                № {t.padStart(4, "0")}
                              </Link>
                            ))}
                          </td>
                          <td data-label="Payouts">{c.count.toLocaleString("en-US")}</td>
                          <td data-label="Received" className={styles.num}>
                            {local(toUsd(c.units), cur, rates)}
                            {cur.code !== "USD" && <span className={styles.usd}>{formatUsd(toUsd(c.units))}</span>}
                          </td>
                          <td data-label="Share" className={styles.num}>
                            {total > 0n ? `${((Number(c.units) / Number(total)) * 100).toFixed(1)}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                <section className={styles.section} aria-labelledby="payouts">
                  <h2 id="payouts">Every payout</h2>
                  <p className="soft">Newest first. Times are UTC. Each block number opens its transaction on MonadVision.</p>
                  <table className={`${styles.table} ${styles.lines}`}>
                    <thead>
                      <tr>
                        <th scope="col">Paid</th>
                        <th scope="col">From</th>
                        <th scope="col">Tab</th>
                        <th scope="col" className={styles.num}>
                          AUSD
                        </th>
                        {cur.code !== "USD" && (
                          <th scope="col" className={styles.num}>
                            {cur.code}
                          </th>
                        )}
                        <th scope="col" className={styles.num}>
                          Block
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {income.map((i, n) => (
                        <tr key={`${i.hash}-${n}`} className={!showAll && n >= FIRST_LINES ? styles.later : undefined}>
                          <td data-label="Paid">{stamp(i.time)}</td>
                          <td data-label="From">{nameOf(names, i.counterparty)}</td>
                          <td data-label="Tab">{i.tab && <span className="serial">№ {i.tab.padStart(4, "0")}</span>}</td>
                          <td data-label="AUSD" className={styles.num}>
                            {formatUsd(toUsd(BigInt(i.amount!)))}
                          </td>
                          {cur.code !== "USD" && (
                            <td data-label={cur.code} className={styles.num}>
                              {local(toUsd(BigInt(i.amount!)), cur, rates)}
                            </td>
                          )}
                          <td data-label="Block" className={styles.num}>
                            <a className="serial" href={explorerTx(i.hash)} target="_blank" rel="noreferrer">
                              {i.block.toLocaleString("en-US")}
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!showAll && income.length > FIRST_LINES && (
                    <button className={`btn small quiet ${styles.more}`} onClick={() => setShowAll(true)}>
                      Show all {income.length.toLocaleString("en-US")} payouts
                    </button>
                  )}
                </section>
              </>
            )}

            {funded.tabs > 0 && (
              <section className={styles.section} aria-labelledby="as-client">
                <h2 id="as-client">Paid out as a client</h2>
                <p className="soft">
                  Tabs this account funded for freelancers in this period. A statement counts only pay received, so none of this is in the totals
                  above.
                </p>
                <dl className={`${styles.facts} ${styles.clientFacts}`}>
                  <div>
                    <dt>Tabs funded</dt>
                    <dd className="denom">{funded.tabs}</dd>
                  </div>
                  <div>
                    <dt>Budgets and top-ups</dt>
                    <dd className="denom">{formatUsd(toUsd(funded.funded))}</dd>
                  </div>
                  <div>
                    <dt>Paid to freelancers</dt>
                    <dd className="denom">{formatUsd(toUsd(funded.paid))}</dd>
                  </div>
                  <div>
                    <dt>Unspent, back to this account</dt>
                    <dd className="denom">{formatUsd(toUsd(funded.refunded))}</dd>
                  </div>
                  <div>
                    <dt>Segundo fees (1%)</dt>
                    <dd className="denom">{formatFee(funded.fees)}</dd>
                  </div>
                  {BigInt(data.totals.feesRefunded ?? "0") > 0n && (
                    <div>
                      <dt>Fees refunded at close, all time</dt>
                      <dd className="denom">{formatFee(BigInt(data.totals.feesRefunded ?? "0"))}</dd>
                    </div>
                  )}
                </dl>
              </section>
            )}

            <section className={styles.verify} aria-labelledby="verify">
              <div>
                <h2 id="verify">How to verify this</h2>
                <ul>
                  <li>
                    <b>Every line is a Monad transaction.</b> Open its block number on MonadVision, a public block explorer, and check the amount, who
                    sent it and who received it. Anyone can, without an account.
                  </li>
                  <li>
                    <b>The statement is computed from the chain, not from Segundo&apos;s records.</b> Every event of the Segundo contract since it was
                    deployed (block <span className="serial">{FROM_BLOCK.toLocaleString("en-US")}</span>) is read from Monad through Envio HyperRPC and
                    added up on the spot. Nobody at Segundo can edit a line.
                  </li>
                  <li>
                    <b>The contract is public and verified.</b> It is deployed under Segundo&apos;s working name, Till, at{" "}
                    <a className="serial" href={explorerAddress(TILL)} target="_blank" rel="noreferrer">
                      {shortAddress(TILL)}
                    </a>
                    , with its source matched on Sourcify. Pay is in AUSD, Agora&apos;s digital dollar, which tracks the US dollar one to one.
                  </li>
                  {cur.code !== "USD" && (
                    <li>
                      <b>{cur.code} amounts are a guide.</b> They use today&apos;s reference rate
                      {ratesUpdated ? ` (open.er-api.com, ${ratesUpdated.replace(/ \d\d:\d\d:\d\d \+0000$/, "")})` : ""}, not the rate on the day each payout
                      landed. The AUSD column is exact.
                    </li>
                  )}
                  <li>
                    <b>This is Monad testnet.</b> Segundo runs on test AUSD for now, so these amounts are not yet real money.
                  </li>
                </ul>
              </div>
              <QrCode url={url} />
            </section>
          </>
        )}

        <p className={styles.printFoot}>
          <span>{url || `segundo.world/proof/${address}`}</span>
          <span>
            Generated {generated ? stamp(generated) : "—"} · as of block <span className="serial">{data ? data.head.toLocaleString("en-US") : "—"}</span>
          </span>
        </p>
      </article>

      <div className={styles.noPrint}>
        <Footer />
      </div>
    </main>
  );
}

/** Today's reference rate into the person's currency; dollars while rates load or when they think in dollars. */
function local(usd: number, cur: Currency, rates: Rates | null) {
  return cur.code === "USD" || !rates ? formatUsd(usd) : formatMoney(usd, cur, rates);
}

/** Time on the clock in the period, from clock-in and clock-out pairs on tabs where this account is the freelancer. */
function clockTime(items: HistoryItem[], since: number, now: number) {
  const open = new Map<string, number>();
  let seconds = 0;
  let count = 0;
  const asc = items.filter((i) => i.role === "freelancer" && (i.kind === "clockIn" || i.kind === "clockOut") && i.tab).reverse();
  for (const i of asc) {
    if (i.kind === "clockIn") open.set(i.tab!, i.time);
    else {
      const start = open.get(i.tab!);
      open.delete(i.tab!);
      if (start == null) continue;
      const from = Math.max(start, since);
      if (i.time > from) {
        seconds += i.time - from;
        count++;
      }
    }
  }
  // A shift still running counts up to now.
  for (const start of open.values()) {
    const from = Math.max(start, since);
    if (now > from) {
      seconds += now - from;
      count++;
    }
  }
  return { seconds, count };
}

/** What this account put into tabs as the client in the period: funded, paid out, refunded and fees. */
function asClient(items: HistoryItem[], since: number) {
  const tabs = new Set<string>();
  let funded = 0n;
  let paid = 0n;
  let refunded = 0n;
  let fees = 0n;
  for (const i of items) {
    if (i.role !== "client" || i.time < since) continue;
    const amount = i.amount ? BigInt(i.amount) : 0n;
    if (i.kind === "opened" || i.kind === "topup") {
      funded += amount;
      if (i.tab) tabs.add(i.tab);
    } else if (i.kind === "paid") paid += amount;
    else if (i.kind === "refund") refunded += amount;
    else if (i.kind === "fee") fees += amount;
  }
  return { tabs: tabs.size, funded, paid, refunded, fees };
}

function byClient(income: HistoryItem[]) {
  const map = new Map<string, { address: Address; units: bigint; count: number; tabs: Set<string> }>();
  for (const i of income) {
    if (!i.counterparty) continue;
    const k = i.counterparty.toLowerCase();
    const row = map.get(k) ?? { address: i.counterparty, units: 0n, count: 0, tabs: new Set<string>() };
    row.units += BigInt(i.amount!);
    row.count++;
    if (i.tab) row.tabs.add(i.tab);
    map.set(k, row);
  }
  return [...map.values()]
    .sort((a, b) => (b.units > a.units ? 1 : b.units < a.units ? -1 : 0))
    .map((r) => ({ ...r, tabs: [...r.tabs].sort((a, b) => Number(a) - Number(b)) }));
}

type Bar = { key: string; label: string; units: bigint };

/** By day when the pay in view spans two months or less, by month otherwise; quiet days and months included. */
function buckets(income: HistoryItem[], since: number, now: number): { byDay: boolean; rows: Bar[] } {
  if (!income.length) return { byDay: true, rows: [] };
  const start = Math.max(since, income.at(-1)!.time);
  const byDay = now - start <= 62 * 86_400;
  const sums = new Map<string, bigint>();
  for (const i of income) {
    const k = byDay ? isoDay(i.time) : isoMonth(i.time);
    sums.set(k, (sums.get(k) ?? 0n) + BigInt(i.amount!));
  }
  const rows: Bar[] = [];
  if (byDay) {
    for (let t = Date.parse(`${isoDay(start)}T00:00:00Z`) / 1000; t <= now; t += 86_400) {
      const k = isoDay(t);
      rows.push({ key: k, label: new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }), units: sums.get(k) ?? 0n });
    }
  } else {
    const d = new Date(start * 1000);
    let y = d.getUTCFullYear();
    let m = d.getUTCMonth();
    const end = isoMonth(now);
    for (;;) {
      const k = `${y}-${String(m + 1).padStart(2, "0")}`;
      rows.push({ key: k, label: new Date(Date.UTC(y, m, 1)).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }), units: sums.get(k) ?? 0n });
      if (k >= end) break;
      m++;
      if (m === 12) {
        m = 0;
        y++;
      }
    }
  }
  return { byDay, rows };
}

function Bars({ bars, byDay, cur, rates }: { bars: Bar[]; byDay: boolean; cur: Currency; rates: Rates | null }) {
  const max = bars.reduce((m, b) => (b.units > m ? b.units : m), 0n);
  const peak = bars.find((b) => b.units === max);
  const every = Math.max(1, Math.ceil(bars.length / 8));
  return (
    <figure className={styles.chart}>
      <ol className={styles.bars} style={{ ["--n" as string]: bars.length }}>
        {bars.map((b, i) => {
          const pct = max > 0n ? (Number(b.units) / Number(max)) * 100 : 0;
          return (
            <li key={b.key} title={`${b.label}: ${local(toUsd(b.units), cur, rates)}`}>
              <span className="visually-hidden">
                {b.label}: {local(toUsd(b.units), cur, rates)}
              </span>
              <span className={styles.col} aria-hidden>
                <span className={styles.bar} style={{ height: `${b.units > 0n ? Math.max(pct, 2) : 0}%` }}>
                  {b === peak && max > 0n && <span className={`${styles.peak} ${i > bars.length / 2 ? styles.peakEnd : ""}`}>{local(toUsd(b.units), cur, rates)}</span>}
                </span>
              </span>
              <span className={styles.tick} aria-hidden>
                {/* Every few bars and the last one, dropping a regular label that would sit on top of the last. */}
                {i === bars.length - 1 || (i % every === 0 && bars.length - 1 - i >= Math.max(2, every)) ? b.label : ""}
              </span>
            </li>
          );
        })}
      </ol>
      <figcaption className="soft">
        {byDay ? "Each bar is one UTC day" : "Each bar is one month"}, in {cur.code === "USD" || !rates ? "US dollars" : cur.name.toLowerCase() + "s at today's rate"}.
      </figcaption>
    </figure>
  );
}

/** An engraved band of interlaced waves along the top of the statement, in the person's currency ink. */
function Border({ seed }: { seed: string }) {
  const paths = useMemo(() => {
    const rnd = mulberry32(seedOf("statement", seed));
    return Array.from({ length: 7 }, (_, i) => wavePath(0, 14, 1000, 4 + rnd() * 7, 18 + rnd() * 26, i * 0.9 + rnd() * 2));
  }, [seed]);
  return (
    <svg className={styles.border} viewBox="0 0 1000 28" preserveAspectRatio="none" aria-hidden>
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

function QrCode({ url }: { url: string }) {
  const [qr, setQr] = useState<{ d: string; n: number } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    import("qrcode")
      .then((QR) => {
        const m = QR.create(url, { errorCorrectionLevel: "M" }).modules;
        let d = "";
        for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.get(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
        if (live) setQr({ d, n: m.size + 4 });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [url]);
  return (
    <figure className={styles.qr}>
      {qr ? (
        <svg viewBox={`0 0 ${qr.n} ${qr.n}`} role="img" aria-label="QR code that opens this statement" shapeRendering="crispEdges" className={styles.qrCode}>
          <rect width={qr.n} height={qr.n} fill="#F4F7F2" />
          <path d={qr.d} fill="#17332B" />
        </svg>
      ) : (
        <div className={`skeleton ${styles.qrCode}`} />
      )}
      <figcaption>Scan to open this statement live and check it against Monad.</figcaption>
    </figure>
  );
}

/**
 * For the owner of a passkey (Mera) account: their legal name, address and tax ID, unsealed on this device with the
 * passkey and printed on the statement. Never sent anywhere; gone on reload.
 */
function Sealed({ address, owner, wallet }: { address: Address; owner: boolean; wallet: ReturnType<typeof useWallet> }) {
  const [details, setDetails] = useState<SealedDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setDetails(null);
    setNote(null);
  }, [address, owner]);
  // Unsealed details leave the page when the passkey session locks, as on the account page.
  useEffect(() => {
    const drop = () => setDetails(null);
    window.addEventListener("segundo:lock", drop);
    return () => window.removeEventListener("segundo:lock", drop);
  }, []);
  if (!owner || !canSeal(wallet)) return null;

  if (details) {
    const place = [details.postalAddress, details.country].filter(Boolean).join(", ");
    return (
      <dl className={styles.sealed}>
        {details.legalName && (
          <div>
            <dt>Legal name</dt>
            <dd>{details.legalName}</dd>
          </div>
        )}
        {place && (
          <div>
            <dt>Address</dt>
            <dd>{place}</dd>
          </div>
        )}
        {details.taxId && (
          <div>
            <dt>Tax ID</dt>
            <dd>{details.taxId}</dd>
          </div>
        )}
        <p className={styles.sealedNote}>Added by the account holder from details sealed with their passkey. Shown on this device only.</p>
      </dl>
    );
  }
  return (
    <div className={styles.addSealed}>
      <button
        className="btn small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setNote(null);
          try {
            const d = await unsealDetails(wallet);
            if (d && (d.legalName || d.postalAddress || d.taxId)) setDetails(d);
            else setNote("No sealed details in this browser yet. Add them from your account first.");
          } catch (e) {
            setNote(e instanceof Error ? e.message : "The passkey didn't open your details.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Waiting for your passkey…" : "Add my sealed details"}
      </button>
      <p className="soft">
        {note ??
          (hasSealedDetails(address)
            ? "Prints your legal name, address and tax ID on this copy. They are unsealed here with your passkey and never leave this device."
            : "Seal your legal name, address and tax ID with your passkey on your account page, then add them to printed statements.")}
      </p>
    </div>
  );
}

function Missing() {
  return (
    <main className={`wrap ${styles.page}`}>
      <h1 className={styles.missing}>That isn&apos;t a Monad address.</h1>
      <p>
        <Link href="/proof">Check a Segundo income statement</Link> by pasting the address it was issued for.
      </p>
    </main>
  );
}

/** A4 print: paper colours whatever the screen theme, no site chrome, every payout line. */
const PRINT = `
@page { size: A4; margin: 14mm 14mm 20mm; }
:root {
  --paper: #ffffff !important; --sheet: #ffffff !important; --ink: #17332b !important; --ink-soft: #4e6159 !important;
  --rule: #cfd8d1 !important; --serial: #c0266d !important; --intaglio: #2d4fa0 !important; --note-paper: #ffffff !important;
}
html, body { background: #fff !important; }
header:not(article header), div[role="status"]:not(main *) { display: none !important; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
a { text-decoration: none !important; }
`;
