"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LiveHero } from "@/components/LiveHero";
import { Mark } from "@/components/Mark";
import { GrandRosette } from "@/components/home/Art";
import { count, money, usdOf, useStats, type Stats } from "@/components/business/stats";
import { NetworkProvider } from "@/lib/network";
import styles from "./deck.module.css";

/** Present mode: one 16:9 slide filling the screen. Below this, the deck reads as a scroll. */
const PRESENT = "(min-width: 900px) and (min-height: 520px)";

type Slide = { id: string; title: string; notes: string; body: (s: Stats | null | undefined) => ReactNode };

const live = (s: Stats | null | undefined, pick: (s: Stats) => string) => (s ? pick(s) : s === undefined ? "…" : "—");

const CITIES = [
  { city: "Manila", code: "PHP", ink: "#2557B0", night: "#93B4F2" },
  { city: "Lagos", code: "NGN", ink: "#1F7A4D", night: "#7BD3A4" },
  { city: "Pune", code: "INR", ink: "#7B3FA0", night: "#C9A2E8" },
  { city: "Nairobi", code: "KES", ink: "#9A5A12", night: "#E7B477" },
  { city: "São Paulo", code: "BRL", ink: "#11777A", night: "#79CFD1" },
];

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
          <h2 className={styles.display}>Get paid every second you work.</h2>
          <p className={styles.lead}>
            Hourly work across borders still pays late and costs too much: <b>10 days</b> before Upwork releases hourly pay, and <b>6.36%</b> on
            average to send money abroad.
          </p>
          <p className={styles.source}>Upwork Help Center, hourly payments · World Bank Remittance Prices Worldwide, Q3 2025</p>
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
      "The World Bank counts up to four hundred and thirty-five million online gig workers. We start with five cities: Manila, Lagos, Pune, Nairobi and São Paulo.",
    body: () => (
      <div className={styles.split}>
        <div>
          <p className={styles.kicker}>Who it hurts</p>
          <h2 className={styles.h}>The people doing the work, far from the people paying for it.</h2>
          <p className={styles.bigNum}>
            <span className="denom">435M</span>
          </p>
          <p className={styles.lead}>online gig workers at the top of the World Bank&apos;s estimate (154 million at the bottom).</p>
          <p className={styles.source}>World Bank, Working Without Borders, 2023</p>
        </div>
        <ul className={styles.cities}>
          {CITIES.map((c) => (
            <li key={c.city} style={{ ["--c" as string]: c.ink, ["--cn" as string]: c.night }}>
              <span className={styles.cityName}>{c.city}</span>
              <span className={`denom ${styles.cityCode}`}>{c.code}</span>
              <span className={styles.cityLine}>Waits for a wire or a platform release, then pays to convert.</span>
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
      "Segundo pays them while they work. The client funds a tab, and every second the freelancer is clocked in, they're paid. This note is a real tab on Monad, live.",
    body: () => (
      <div className={styles.split}>
        <div>
          <p className={styles.kicker}>The solution</p>
          <h2 className={styles.h}>A tab that pays while you work.</h2>
          <ul className={styles.ticks}>
            <li>The client funds a budget before work starts.</li>
            <li>Pay builds up every second the freelancer is clocked in.</li>
            <li>It lands in their wallet every few seconds, in digital dollars.</li>
            <li>Unspent budget goes straight back to the client.</li>
          </ul>
        </div>
        <div className={styles.noteBox}>
          <LiveHero />
        </div>
      </div>
    ),
  },
  {
    id: "how",
    title: "How it works",
    notes:
      "Three steps. The client opens a tab in Agora's digital dollar and sends a link. The freelancer signs up with a passkey and clocks in. No wallet app, no gas.",
    body: () => (
      <div>
        <p className={styles.kicker}>How it works</p>
        <h2 className={styles.h}>Three steps, one signature each, no gas.</h2>
        <ol className={styles.steps}>
          <li>
            <span className="denom">1</span>
            <h3>The client opens a tab</h3>
            <p>An hourly rate and a budget in AUSD, Agora&apos;s digital dollar. The budget waits in a public contract on Monad.</p>
          </li>
          <li>
            <span className="denom">2</span>
            <h3>The freelancer clocks in</h3>
            <p>From an invite link, with a passkey or email. No wallet app, no seed phrase, no MON for gas.</p>
          </li>
          <li>
            <span className="denom">3</span>
            <h3>Paid as they go</h3>
            <p>Earnings land every few seconds. Either side can stop the clock; closing refunds every unspent cent.</p>
          </li>
        </ol>
      </div>
    ),
  },
  {
    id: "monad",
    title: "Why Monad",
    notes:
      "This needs Monad. Blocks every three hundred milliseconds mean a payout lands while you're watching, and tabs never queue behind each other.",
    body: (s) => (
      <div className={styles.split}>
        <div>
          <p className={styles.kicker}>Why Monad</p>
          <h2 className={styles.h}>Pay you can watch arrive.</h2>
          <ul className={styles.ticks}>
            <li>A block every 0.3 s and finality in 0.6 s: a payout lands while the freelancer is still looking.</li>
            <li>Pay accrues from timestamps, so tabs never queue behind each other.</li>
            <li>Every action is a signature; Segundo&apos;s relayer pays the gas.</li>
          </ul>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Pay lands on a running tab every</span>
          <span className={`denom ${styles.bigNum}`}>
            {live(s, (x) => (x.settle.medianMs == null ? "—" : `${(x.settle.medianMs / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} s`))}
          </span>
          <span className={styles.source}>Median gap between payouts on Segundo tabs, Monad testnet. Block and finality times from Monad&apos;s docs.</span>
        </div>
      </div>
    ),
  },
  {
    id: "model",
    title: "Business model",
    notes:
      "Here's how we make money. Clients pay one percent on top of what they fund; freelancers pay nothing. It's live on testnet: that's our treasury. Next come yield on escrowed budgets, cash-out, and advances.",
    body: (s) => (
      <div className={styles.split}>
        <div>
          <p className={styles.kicker}>Business model</p>
          <h2 className={styles.h}>Clients pay 1%. Freelancers pay nothing.</h2>
          <ol className={styles.lines}>
            <li>
              <b>1% client fee</b> <span className={styles.on}>Live on testnet</span>
            </li>
            <li>
              <b>Share of AUSD reserve yield on budgets in escrow</b> <span>Next</span>
            </li>
            <li>
              <b>Cash-out spread with local payout partners</b> <span>Next</span>
            </li>
            <li>
              <b>Advances against verified on-chain income</b> <span>Later</span>
            </li>
          </ol>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Fees in the Segundo treasury</span>
          <span className={`denom ${styles.bigNum} ${styles.serialNum}`}>{live(s, (x) => money(usdOf(x.fees.total)))}</span>
          <span className={styles.statLabel}>{live(s, (x) => `${count(x.fees.count)} fees, each a public transfer on Monad`)}</span>
          <span className={styles.source}>Testnet, including our demo studios. Test AUSD has no value.</span>
        </div>
      </div>
    ),
  },
  {
    id: "market",
    title: "Market",
    notes:
      "Hundreds of millions of people work online, and Upwork alone handled about four billion dollars of work last year. One percent of that is forty million a year.",
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
            <span className={`denom ${styles.bigNum}`}>$4.03B</span>
            <p>of work bought through Upwork alone in 2025</p>
            <p className={styles.source}>Upwork gross services volume, FY 2025 (Form 8-K)</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "competition",
    title: "Competition",
    notes:
      "Marketplaces pay days late and take up to twenty percent. Payroll and transfer apps still wait for an invoice. Crypto streams need a wallet. Segundo pays by the second, for time worked.",
    body: () => (
      <div>
        <p className={styles.kicker}>Competition</p>
        <h2 className={styles.h}>Everyone else pays after the work. We pay during it.</h2>
        <div className={styles.matrix} role="table" aria-label="Segundo and the alternatives">
          <div role="row" className={styles.mHead}>
            <span role="columnheader" />
            <span role="columnheader">When money arrives</span>
            <span role="columnheader">Cost to the freelancer</span>
            <span role="columnheader">If the client disappears</span>
          </div>
          {[
            ["Marketplaces", "10 days after the week (Upwork)", "0–15% on Upwork, 20% on Fiverr", "Open a dispute"],
            ["Contractor payroll", "On the payroll date", "None; the company pays $29–49 a month", "Chase an invoice"],
            ["Receive and convert", "When the client pays", "Receiving and conversion fees", "Chase an invoice"],
            ["Crypto streaming", "By calendar time, not time worked", "Gas, a wallet, a seed phrase", "Paid until the stream stops"],
            ["Segundo", "Every second you're clocked in", "Nothing. Client pays 1%", "Already paid for every second"],
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
    id: "traction",
    title: "Traction",
    notes:
      "It's live. These numbers come from the chain right now. To be clear, it's testnet, and they include our demo studios, which are bots.",
    body: (s) => (
      <div>
        <p className={styles.kicker}>Traction</p>
        <h2 className={styles.h}>Live on Monad testnet, read from the chain now.</h2>
        <dl className={styles.traction}>
          {(
            [
              ["Paid to freelancers", (x: Stats) => money(usdOf(x.paid.total))],
              ["Payouts", (x: Stats) => count(x.paid.payouts)],
              ["Tabs", (x: Stats) => count(x.paid.tabs)],
              ["Freelancers paid", (x: Stats) => count(x.paid.freelancers)],
              ["Clients", (x: Stats) => count(x.paid.clients)],
              ["Fees collected", (x: Stats) => money(usdOf(x.fees.total))],
            ] as const
          ).map(([k, f]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="denom">{live(s, f)}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.source}>
          Testnet, including our demo studios (three bot studios paying five bot freelancers). Contract verified on Sourcify, 53 Foundry tests including
          fuzz and invariant runs.
        </p>
      </div>
    ),
  },
  {
    id: "next",
    title: "Next",
    notes:
      "Next: mainnet on the same contract, local cash-out partners, and time-tracker plug-ins. If you hire abroad, pay out locally, or invest in payments, let's talk. Thank you.",
    body: () => (
      <div className={styles.split}>
        <div>
          <p className={styles.kicker}>What&apos;s next</p>
          <h2 className={styles.h}>From testnet to the first real paycheck.</h2>
          <ol className={styles.lines}>
            <li>
              <b>Mainnet on AUSD, the same contract, audited</b>
            </li>
            <li>
              <b>Cash-out partners</b>: pesos, naira, rupees, shillings and reais to banks and mobile money
            </li>
            <li>
              <b>Time-tracker plug-ins</b>: the tools freelancers already use clock them in
            </li>
            <li>
              <b>Advances</b> against verified on-chain income
            </li>
          </ol>
        </div>
        <div className={styles.ask}>
          <p className={styles.kicker}>The ask</p>
          <p className={styles.askText}>Studios that hire abroad, payout partners in our five corridors, and investors in payments: let&apos;s talk.</p>
          <p className={styles.askLink}>
            <span className="serial">segundo.world</span>
          </p>
          <p className={styles.source}>Rohan Borade, founder</p>
        </div>
      </div>
    ),
  },
];

export default function DeckPage() {
  const stats = useStats(30_000);
  const [at, setAt] = useState(0);
  const [notes, setNotes] = useState(false);
  const [present, setPresent] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
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

  const onStageClick = (e: React.MouseEvent) => {
    if (!present) return;
    if ((e.target as HTMLElement).closest("a, button, input, summary, [role='button']")) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    go(e.clientX - box.left < box.width / 3 ? at - 1 : at + 1);
  };

  return (
    <NetworkProvider>
      <div className={styles.deck} ref={stage} data-notes={notes ? "on" : undefined}>
        <div className={styles.toolbar}>
          <Link href="/business" className={styles.back}>
            How Segundo makes money
          </Link>
          <button type="button" className="btn small quiet" aria-pressed={notes} onClick={() => setNotes((v) => !v)}>
            {notes ? "Hide speaker notes" : "Speaker notes"} <kbd className={styles.kbd}>n</kbd>
          </button>
        </div>
        <div className={styles.stage} onClick={onStageClick}>
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
                <div className={styles.slideBody}>{s.body(stats)}</div>
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
      </div>
    </NetworkProvider>
  );
}
