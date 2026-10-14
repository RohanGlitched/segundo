"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LiveHero } from "@/components/LiveHero";
import { Mark } from "@/components/Mark";
import { GrandRosette } from "@/components/home/Art";
import { useBench, type Bench } from "@/components/home/UnderLoad";
import { catchingUp, count, isFull, money, usdOf, useStats, type Stats } from "@/components/business/stats";
import { ASK, AT_DEFAULTS, EXAMPLE, POLICY, feePerMonth, headroom } from "@/components/business/economics";
import { NetworkProvider } from "@/lib/network";
import benchRun from "@/public/bench.json";
import styles from "./deck.module.css";

/** Present mode: one 16:9 slide filling the screen. Below this, the deck reads as a scroll. */
const PRESENT = "(min-width: 900px) and (min-height: 520px)";

type Slide = { id: string; title: string; notes: string; body: (s: Stats | null | undefined, b: Bench | null | undefined) => ReactNode };

const live = (s: Stats | null | undefined, pick: (s: Stats) => string) => (s ? pick(s) : s === undefined ? "…" : "—");
/** False when /api/stats fell back to the public RPC, whose short window can't split or count the whole history. */
const whole = isFull;
/** Fees net of the refunds sent back at close, and the gross they come from: the same two lines on every slide. */
const feesNet = (x: Stats) => money(usdOf(x.fees.net ?? x.fees.total));
const feesGross = (x: Stats) =>
  `net of ${count(x.fees.refunds ?? 0)} ${x.fees.refunds === 1 ? "refund" : "refunds"} at close; ${money(usdOf(x.fees.total))} collected in ${count(x.fees.count)} ${
    x.fees.count === 1 ? "fee" : "fees"
  }`;
/** Monad's average block time over 10,000 blocks, the October 13 measurement every page and doc quotes. */
const BLOCK_TIME = `${(benchRun.blockTime.avgMs / 1000).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} s`;
const DEMO_VIDEO = "https://youtu.be/U6be6-HecJI";

const CITIES = [
  { city: "Manila", code: "PHP", ink: "#2557B0", night: "#93B4F2", line: "Designers and assistants for studios abroad. Wants pesos in GCash, over InstaPay." },
  { city: "Lagos", code: "NGN", ink: "#1F7A4D", night: "#7BD3A4", line: "Developers billed in dollars. The naira moves fast, so the rate on the day matters." },
  { city: "Pune", code: "INR", ink: "#7B3FA0", night: "#C9A2E8", line: "Engineering contractors on monthly hours. UPI at home, 1% tax deducted on crypto cash-out." },
  { city: "Nairobi", code: "KES", ink: "#9A5A12", night: "#E7B477", line: "Remote work where everyday money is M-Pesa, not a bank account." },
  { city: "São Paulo", code: "BRL", ink: "#11777A", night: "#79CFD1", line: "Developers on US hours. Pix at home is instant and free; the wire isn't." },
];

/** Gas room in the load test's busiest block, from the recorded run. */
const ROOM = headroom(benchRun.perBlock, benchRun.blockTime.avgMs);
const MONTH_PAY = EXAMPLE.hours * (52 / 12) * EXAMPLE.rate;
const usd0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const SLIDES: Slide[] = [
  {
    id: "problem",
    title: "Segundo",
    notes:
      "Hi, I'm Rohan, and this is Segundo. If you freelance by the hour for a client abroad, you wait about ten days for your pay, then lose more of it getting it home.",
    body: () => (
      <div className={styles.cover}>
        <div className={styles.coverText}>
          <p className={styles.kicker}>Segundo</p>
          <h1 className={styles.display}>Get paid every second you work.</h1>
          <p className={styles.lead}>
            Upwork releases hourly pay <b>10 days</b> after the week ends, and takes up to <b>15%</b> from the freelancer plus up to 7.99% from the
            client. Off the platform, the freelancer chases an invoice.
          </p>
          <p className={styles.source}>Upwork Help Center: hourly payments, freelancer service fees, client marketplace fee</p>
        </div>
        <div className={styles.coverArt} aria-hidden>
          <GrandRosette />
        </div>
      </div>
    ),
  },
  {
    id: "who",
    title: "Who it hurts",
    notes:
      "The World Bank counts between a hundred and fifty-four and four hundred and thirty-five million online gig workers. We start with five cities: Manila, Lagos, Pune, Nairobi and São Paulo.",
    body: () => (
      <div className={styles.split}>
        <div>
          <p className={styles.kicker}>Who it hurts</p>
          <h2 className={styles.h}>The people doing the work, far from the people paying for it.</h2>
          <p className={styles.bigNum}>
            <span className="denom">154–435M</span>
          </p>
          <p className={styles.lead}>online gig workers worldwide, the World Bank&apos;s range: 4.4% to 12.5% of the global labour force.</p>
          <p className={styles.source}>
            World Bank, Working Without Borders, 2023. Sending $200 abroad costs 6.36% on average (World Bank, Q3 2025); Wise and Payoneer cost
            less, but pay only once the invoice is paid.
          </p>
        </div>
        <ul className={styles.cities}>
          {CITIES.map((c) => (
            <li key={c.city} style={{ ["--c" as string]: c.ink, ["--cn" as string]: c.night }}>
              <span className={styles.cityName}>{c.city}</span>
              <span className={`denom ${styles.cityCode}`}>{c.code}</span>
              <span className={styles.cityLine}>{c.line}</span>
            </li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    id: "solution",
    title: "The solution",
    notes:
      "Segundo pays them while they work. The client opens a tab in Agora's digital dollar and sends a link; the freelancer signs up with a passkey and clocks in, with no wallet app and no gas. Every second they're clocked in, they earn. This note is a real tab on Monad, live.",
    body: () => (
      <div className={styles.split}>
        <div>
          <p className={styles.kicker}>The solution</p>
          <h2 className={styles.h}>A tab that pays while you work.</h2>
          <ul className={styles.ticks}>
            <li>The client opens a tab: an hourly rate and a budget in AUSD, Agora&apos;s digital dollar, locked in a public contract on Monad.</li>
            <li>The freelancer joins from a link with a passkey or email and clocks in. No wallet app, no seed phrase, no gas.</li>
            <li>Pay is earned every second on the clock and paid out to their wallet as they work.</li>
            <li>Either side can stop the clock. Closing returns the unspent budget, and the 1% fee on it.</li>
          </ul>
        </div>
        <div className={styles.noteBox}>
          <LiveHero />
        </div>
      </div>
    ),
  },
  {
    id: "monad",
    title: "Why Monad",
    notes:
      "Any chain can count seconds, and Segundo counts them for free with timestamps. Monad is where paying them out makes sense. Every payout is a real transaction in AUSD, and in our load test ninety-six payouts used eight percent of one Monad block: room for about eleven hundred. Next, a vault per tab lets payouts to different freelancers run in parallel.",
    body: () => (
      <div className={styles.split}>
        <div>
          <p className={styles.kicker}>Why Monad</p>
          <h2 className={styles.h}>Any chain can count seconds. Monad is where paying them out fits.</h2>
          <ul className={styles.ticks}>
            <li>Counting is timestamp math, free on any chain. Every payout is a real EVM transaction in AUSD.</li>
            <li>
              {ROOM.payouts} payouts used {ROOM.pct}% of one block: room for about {ROOM.perBlock.toLocaleString("en-US")}.{" "}
              <Link href="/network">segundo.world/network</Link>
            </li>
            <li>Next: a vault per tab, so payouts run in parallel. Today they share one balance slot.</li>
          </ul>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Payouts one block has room for</span>
          <span className={`denom ${styles.bigNum}`}>~{ROOM.perBlock.toLocaleString("en-US")}</span>
          <span className={styles.statLabel}>Average Monad block, over 10,000 (Oct 13)</span>
          <span className={`denom ${styles.bigNum}`}>{BLOCK_TIME}</span>
          <span className={styles.source}>
            {ROOM.payouts} settles filled {ROOM.pct}% of block {ROOM.block.toLocaleString("en-US")}{" "}
            on Monad testnet; gas room, not a measured rate. Monad charges the gas limit, so the relayer sends the estimate plus 15%, from a pool of keys.
          </span>
        </div>
      </div>
    ),
  },
  {
    id: "model",
    title: "Business model",
    notes:
      "Here's how we make money. Clients pay one percent of what they spend; unspent budget and its fee come back at close. Freelancers pay nothing to be paid. At twenty dollars an hour that's twenty cents a tab-hour, and with payouts batched the relayer's gas is about two cents of it. Next come yield on escrowed budgets, a share of the cash-out spread, and advances.",
    body: (s) => (
      <div className={styles.split}>
        <div>
          <p className={styles.kicker}>Business model</p>
          <h2 className={styles.h}>Clients pay 1% of what they spend. Freelancers pay nothing to be paid.</h2>
          <ol className={styles.lines}>
            <li>
              <b>1% client fee; unspent budget and its fee come back</b> <span className={styles.on}>Live on testnet</span>
            </li>
            <li>
              <b>Share of AUSD reserve yield on budgets in escrow, part of it passed back to the client</b> <span>Next</span>
            </li>
            <li>
              <b>Share of the cash-out spread, never on top</b> <span>Next</span>
            </li>
            <li>
              <b>Advances against verified on-chain income</b> <span>Later</span>
            </li>
          </ol>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>One tab-hour at ${EXAMPLE.rate}</span>
          <dl className={styles.unit}>
            <div>
              <dt>Client fee, 1%</dt>
              <dd className="denom">${AT_DEFAULTS.feeTabHour.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Relayer gas, batched</dt>
              <dd className="denom">${AT_DEFAULTS.gasTabHour.toFixed(3)}</dd>
            </div>
            <div className={styles.unitTotal}>
              <dt>Left after gas</dt>
              <dd className="denom">{Math.round((1 - AT_DEFAULTS.gasShare) * 100)}%</dd>
            </div>
          </dl>
          <span className={styles.source}>
            Payouts every {POLICY.onScreenS} s on screen and every {POLICY.offScreenS / 60} minutes otherwise, batched; gas from relayer receipts at
            102 gwei and MON at $0.05. At that schedule the fee covers gas until MON reaches ${AT_DEFAULTS.breakEvenMon.toFixed(2)}. Gas only: the
            calculator on /business adds other variable costs.
          </span>
          <span className={styles.source}>
            {live(s, (x) => (whole(x) ? `Fees kept on testnet so far: ${feesNet(x)}, ${feesGross(x)}.` : catchingUp(x) ?? ""))} Test AUSD has no
            value; the tab contract has no fee switch.
          </span>
        </div>
      </div>
    ),
  },
  {
    id: "units",
    title: "Against the incumbents",
    notes:
      "Per freelancer, at thirty-five hours a week and twenty dollars an hour, one percent is about thirty dollars a month, paid by the client and only when work happens. Deel and Remote sell a seat for contract management, forty-nine and from twenty-nine dollars a month; that's a different job, and Segundo is the pay rail. Upwork takes up to fifteen percent from the freelancer plus up to eight from the client. For the client, the 1% buys paying only for seconds worked, no invoices to process, no outgoing wire fees and one balance for five countries.",
    body: () => (
      <div>
        <p className={styles.kicker}>Unit economics</p>
        <h2 className={styles.h}>About ${Math.round(feePerMonth())} a freelancer-month, charged only when work happens.</h2>
        <p className={styles.lead}>
          The client gets for it: pay only for seconds worked, pause any second, no invoices to process, no outgoing wire fees, one balance for five
          countries.
        </p>
        <div className={styles.matrix} role="table" aria-label="A month of one freelancer's work, priced four ways">
          <div role="row" className={styles.mHead}>
            <span role="columnheader">
              <span className="visually-hidden">Service</span>
            </span>
            <span role="columnheader">
              A month at {EXAMPLE.hours} h a week and ${EXAMPLE.rate} ({usd0(MONTH_PAY)} of work)
            </span>
            <span role="columnheader">Who pays</span>
            <span role="columnheader">In a month with no work</span>
          </div>
          {[
            ["Segundo", `${usd0(feePerMonth())}, 1% of what is spent: the pay rail`, "The client", "$0"],
            ["Deel", "$49 per contractor, for contracts, tax forms and invoices", "The company", "$49"],
            ["Remote", "From $29 per contractor, for contracts, tax forms and invoices", "The company", "From $29"],
            ["Upwork", `Up to ${usd0(MONTH_PAY * 0.15)} (15%) plus up to ${usd0(MONTH_PAY * 0.0799)} (7.99%)`, "Freelancer and client", "$0"],
          ].map((r) => (
            <div role="row" key={r[0]} className={r[0] === "Segundo" ? styles.mUs : undefined}>
              <span role="rowheader">{r[0]}</span>
              <span role="cell">{r[1]}</span>
              <span role="cell">{r[2]}</span>
              <span role="cell">{r[3]}</span>
            </div>
          ))}
        </div>
        <p className={styles.source}>
          Deel and Remote pricing pages; Upwork Help Center, freelancer service fees and client marketplace fee. A month is 52 ÷ 12 weeks. Deel and
          Remote sell contractor management, not the pay rail. On price against Wise or Payoneer, Segundo is about even once a cash-out spread
          (assumed 1%) is added; the difference there is timing and a budget locked before work starts.
        </p>
      </div>
    ),
  },
  {
    id: "market",
    title: "Market",
    notes:
      "Hundreds of millions of people work online. From the bottom up: five hundred and thirty-six thousand Payoneer customers, freelancers and online sellers, each move more than five hundred dollars a month across borders. Their pay, three to ten billion dollars a year, is our serviceable market; at one percent, that's thirty-two to a hundred and five million in revenue. That's an estimate, and every input is on the business page.",
    body: () => (
      <div>
        <p className={styles.kicker}>Market</p>
        <h2 className={styles.h}>Big, cross-border, and paying too much.</h2>
        <div className={styles.market}>
          <div>
            <span className={`denom ${styles.bigNum}`}>154–435M</span>
            <p>online gig workers worldwide</p>
            <p className={styles.source}>World Bank, 2023</p>
          </div>
          <div>
            <span className={`denom ${styles.bigNum}`}>$685B</span>
            <p>sent home to low- and middle-income countries in 2024</p>
            <p className={styles.source}>World Bank estimate, December 2024</p>
          </div>
          <div>
            <span className={`denom ${styles.bigNum}`}>$3.2–10.5B</span>
            <p>of cross-border pay a year, the serviceable market, bottom up. At 1%: $32–105M a year in revenue</p>
            <p className={styles.source}>
              536,000 Payoneer customers, freelancers and online sellers, moving over $500 a month (Payoneer FY 2025, Form 8-K) × $6,000 to $19,500 a year (the upper end is our assumption:
              25 h a week at $15)
            </p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "competition",
    title: "Competition",
    notes:
      "Marketplaces pay late: Upwork releases hourly pay ten days after the week and takes up to fifteen percent, and Fiverr keeps twenty percent of each order. Payroll waits for the payroll run, and transfer apps wait for an invoice. Stablecoin payroll, like Rise, Bitwage or Request Finance, pays in USDC on a pay date, with a wallet to manage. Crypto streams run by calendar time and need a wallet. Segundo pays by time worked, from a capped budget funded first, with a passkey and no wallet app.",
    body: () => (
      <div>
        <p className={styles.kicker}>Competition</p>
        <h2 className={styles.h}>Everyone else pays after the work. We pay during it.</h2>
        <div className={styles.matrix} role="table" aria-label="Segundo and the alternatives">
          <div role="row" className={styles.mHead}>
            <span role="columnheader">
              <span className="visually-hidden">Option</span>
            </span>
            <span role="columnheader">When money arrives</span>
            <span role="columnheader">Cost to the freelancer</span>
            <span role="columnheader">If the client disappears</span>
          </div>
          {[
            ["Marketplaces", "10 days after the week (Upwork)", "0–15% on Upwork, 20% on Fiverr", "Open a dispute"],
            ["Contractor payroll", "On the payroll date", "None; the company pays $29–49 a month for contract management", "Waits for the payroll run"],
            ["Stablecoin payroll (Rise, Bitwage, Request Finance)", "On a pay date, in USDC", "A wallet or provider account to manage", "Waits for the pay run"],
            ["Receive and convert", "When the client pays", "Receiving and conversion fees", "Chase an invoice"],
            ["Crypto streaming", "Calendar-time streams the payer manages; no clock-in, no cap per hour", "Gas, a wallet, a seed phrase", "Paid until the stream stops"],
            ["Segundo", "Earned every second you're clocked in, paid out as you work", "Nothing to be paid. Client pays 1% of what they spend", "Every second worked is paid or locked to you"],
          ].map((r) => (
            <div role="row" key={r[0]} className={r[0] === "Segundo" ? styles.mUs : undefined}>
              <span role="rowheader">{r[0]}</span>
              <span role="cell">{r[1]}</span>
              <span role="cell">{r[2]}</span>
              <span role="cell">{r[3]}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: "proof",
    title: "Live proof",
    notes:
      "It's live. These numbers come from the chain right now, split honestly: wallets that aren't ours, then our own test wallets, then our demo studios, which are bots. Fees are shown net of what went back to clients at close.",
    body: (s) => (
      <div>
        <p className={styles.kicker}>Live proof</p>
        <h2 className={styles.h}>Live on Monad testnet, read from the chain now.</h2>
        <dl className={styles.traction}>
          {(
            [
              ["Outside wallets", (x: Stats) => (whole(x) && x.outside ? count(x.outside.wallets) : "—")],
              ["Their tabs", (x: Stats) => (whole(x) && x.outside ? count(x.outside.tabs) : "—")],
              ["Paid on their tabs", (x: Stats) => (whole(x) && x.outside ? money(usdOf(x.outside.paid)) : "—")],
              ["Team test wallets' tabs", (x: Stats) => (whole(x) && x.team ? count(x.team.tabs) : "—")],
              ["Demo studios' tabs (bots)", (x: Stats) => (whole(x) && x.demo ? `${count(x.demo.tabs)}, ${money(usdOf(x.demo.paid))} paid` : "—")],
              ["Fees kept, net of refunds", (x: Stats) => (whole(x) ? feesNet(x) : "—")],
            ] as const
          ).map(([k, f]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="denom">{live(s, f)}</dd>
              {k.startsWith("Fees") && s && whole(s) && <dd className={styles.tractionSub}>{feesGross(s)}</dd>}
            </div>
          ))}
        </dl>
        <p className={styles.source}>
          {s && catchingUp(s) ? `${catchingUp(s)} ` : ""}Outside wallets are wallets the team doesn&apos;t control; our known test wallets (public in
          VERIFY.md) are counted apart, though fresh accounts from our test scripts can&apos;t be told apart. Demo studios: three bot studios paying
          five bot freelancers. The load test is left out. Contract verified on Sourcify, 52 Foundry tests including fuzz and invariant runs.
        </p>
      </div>
    ),
  },
  {
    id: "next",
    title: "Next",
    notes:
      "In the next ninety days: an audit and mainnet on AUSD, ten design-partner studios, a cash-out partner in the Philippines and one in Nigeria, and an on-ramp partner for euros and dollars. I'm raising a five hundred thousand dollar pre-seed for twelve months to do exactly that. I'm Rohan, building this solo from India; the first hire is a payments and compliance lead. If you hire abroad, pay out locally, or invest in payments, let's talk. Thank you.",
    body: () => (
      <div className={styles.split}>
        <div>
          <p className={styles.kicker}>The next 90 days</p>
          <h2 className={styles.h}>From testnet to the first real paycheck.</h2>
          <ol className={styles.lines}>
            <li>
              <div className={styles.lineText}>
                <b>Audit, then mainnet on AUSD:</b> the same contract, with batched payouts
              </div>
            </li>
            <li>
              <div className={styles.lineText}>
                <b>10 design-partner studios</b> paying freelancers in our five cities
              </div>
            </li>
            <li>
              <div className={styles.lineText}>
                <b>Cash-out partners:</b> one in the Philippines, one in Nigeria
              </div>
            </li>
            <li>
              <div className={styles.lineText}>
                <b>An on-ramp partner</b> so studios fund tabs from euros or dollars in a bank
              </div>
            </li>
          </ol>
        </div>
        <div className={styles.ask}>
          <p className={styles.kicker}>The ask</p>
          <p className={styles.askText}>{ASK}</p>
          <p className={styles.source}>
            Studios that hire abroad: be one of the ten. Payout partners in Manila and Lagos: sign the first corridor.
          </p>
          <p className={styles.askLink}>
            <span className="serial">segundo.world</span> ·{" "}
            <a href={DEMO_VIDEO} target="_blank" rel="noreferrer">
              Watch the demo video
            </a>
          </p>
          <p className={styles.source}>Rohan Borade, founder, building solo from India. First hire: a payments and compliance lead.</p>
        </div>
      </div>
    ),
  },
];

export default function DeckPage() {
  const stats = useStats(30_000);
  const bench = useBench();
  const [at, setAt] = useState(0);
  const [notes, setNotes] = useState(false);
  const [present, setPresent] = useState(false);
  const stage = useRef<HTMLElement>(null);
  const n = SLIDES.length;

  const go = useCallback((i: number) => setAt(Math.max(0, Math.min(n - 1, i))), [n]);

  useEffect(() => {
    const mq = window.matchMedia(PRESENT);
    const on = () => setPresent(mq.matches);
    on();
    mq.addEventListener("change", on);
    const fromHash = Number(window.location.hash.slice(1));
    if (Number.isInteger(fromHash) && fromHash >= 1 && fromHash <= n) setAt(fromHash - 1);
    return () => mq.removeEventListener("change", on);
  }, [n]);

  useEffect(() => {
    if (!present) return;
    window.history.replaceState(null, "", `#${at + 1}`);
  }, [at, present]);

  // In present mode the deck covers the page, so the site's own header and footer underneath leave the tab order
  // (and the accessibility tree) until it stops covering them.
  useEffect(() => {
    if (!present) return;
    const hidden = new Set<HTMLElement>();
    const hide = () => {
      for (const el of document.querySelectorAll<HTMLElement>("header, footer")) {
        if (hidden.has(el) || stage.current?.contains(el) || el.inert) continue;
        el.inert = true;
        el.setAttribute("aria-hidden", "true");
        hidden.add(el);
      }
    };
    hide();
    // The layout can mount its header after the deck does; catch it when it arrives.
    const watch = new MutationObserver(hide);
    watch.observe(document.body, { childList: true, subtree: true });
    return () => {
      watch.disconnect();
      for (const el of hidden) {
        el.inert = false;
        el.removeAttribute("aria-hidden");
      }
    };
  }, [present]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "n" || e.key === "N") return setNotes((v) => !v);
      if (!present) return;
      if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else stage.current?.requestFullscreen?.().catch(() => {});
        return;
      }
      const next = ["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key);
      const prev = ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key);
      if (next || prev || e.key === "Home" || e.key === "End") {
        // Space keeps its meaning on a focused button or link.
        if (e.key === " " && t && /^(BUTTON|A)$/.test(t.tagName)) return;
        e.preventDefault();
        if (next) setAt((i) => Math.min(n - 1, i + 1));
        else if (prev) setAt((i) => Math.max(0, i - 1));
        else setAt(e.key === "Home" ? 0 : n - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [present, n]);

  // Touch tablets: a horizontal swipe moves a slide; a mostly vertical drag is left alone.
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!present || e.pointerType === "mouse") return;
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!present || !start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    swiped.current = true;
    go(dx < 0 ? at + 1 : at - 1);
  };

  const onStageClick = (e: React.MouseEvent) => {
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    if (!present) return;
    if ((e.target as HTMLElement).closest("a, button, input, summary, [role='button']")) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    go(e.clientX - box.left < box.width / 3 ? at - 1 : at + 1);
  };

  return (
    <NetworkProvider>
      <main id="main" className={styles.deck} ref={stage} data-notes={notes ? "on" : undefined}>
        <div className={styles.toolbar}>
          <Link href="/business" className={styles.back}>
            How Segundo makes money
          </Link>
          <button type="button" className="btn small quiet" aria-pressed={notes} onClick={() => setNotes((v) => !v)}>
            {notes ? "Hide speaker notes" : "Speaker notes"} <kbd className={styles.kbd}>n</kbd>
          </button>
        </div>
        <div
          className={styles.stage}
          onClick={onStageClick}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (swipe.current = null)}
        >
          {SLIDES.map((s, i) => (
            <section
              key={s.id}
              className={styles.slide}
              data-on={i === at ? "" : undefined}
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${n}: ${s.title}`}
            >
              <div className={styles.frame}>
                <header className={styles.slideTop}>
                  <span className={styles.brand}>
                    <Mark size={22} /> Segundo
                  </span>
                  <span className={`serial ${styles.no}`}>
                    № {String(i + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
                  </span>
                </header>
                <div className={styles.slideBody}>{s.body(stats, bench)}</div>
              </div>
              <aside className={styles.notes} aria-label={`Speaker notes for slide ${i + 1}`}>
                {s.notes}
              </aside>
            </section>
          ))}
        </div>
        {present && notes && (
          <aside className={styles.notesPanel} aria-label="Speaker notes" aria-live="polite">
            {SLIDES[at]!.notes}
          </aside>
        )}
        <nav className={styles.controls} aria-label="Slides">
          <button type="button" className={styles.ctl} onClick={() => go(at - 1)} disabled={at === 0} aria-label="Previous slide">
            ←
          </button>
          <span className={styles.count} aria-live="polite">
            {at + 1} / {n} · {SLIDES[at]!.title}
          </span>
          <button type="button" className={styles.ctl} onClick={() => go(at + 1)} disabled={at === n - 1} aria-label="Next slide">
            →
          </button>
          <span className={styles.keys}>Arrows or click to move · n notes · f full screen</span>
          <div className={styles.progress} aria-hidden>
            <i style={{ width: `${((at + 1) / n) * 100}%` }} />
          </div>
        </nav>
      </main>
    </NetworkProvider>
  );
}
