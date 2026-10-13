import Link from "next/link";
import { Footer } from "@/components/Footer";
import { LiveHero, LiveStrip } from "@/components/LiveHero";
import { ArrivalChart } from "@/components/home/ArrivalChart";
import { Divider, GrandRosette } from "@/components/home/Art";
import { BlockTape } from "@/components/home/BlockTape";
import { Faq } from "@/components/home/Faq";
import { InkSheet } from "@/components/home/InkSheet";
import { Money } from "@/components/home/Money";
import { NoteAnatomy } from "@/components/home/NoteAnatomy";
import { WorldClock } from "@/components/home/WorldClock";
import home from "@/components/home/home.module.css";
import { NetworkProvider } from "@/lib/network";
import styles from "./page.module.css";

const STEPS = [
  {
    title: "The client opens a tab",
    body: "They set an hourly rate and a budget in AUSD, Agora's digital dollar, and send you an invite link. The budget waits in Segundo's contract on Monad, where it can only go to you or back to them.",
  },
  {
    title: "You clock in",
    body: "Pay builds up every second you're on the clock. Either of you can stop the clock at any moment, and the client can pause pay or close the tab.",
  },
  {
    title: "You're paid as you go",
    body: "Earnings move to your wallet while you work, and you can cash out at any second. When the tab closes, the unspent budget goes straight back to the client.",
  },
];

const COMPARE = [
  {
    what: "When the money arrives",
    wire: "Days after the invoice is finally paid",
    market: "About 10 days after the work week (Upwork hourly)",
    till: "Every second, while you work",
  },
  {
    what: "What it costs to receive",
    wire: "6.36% on average to send money across borders (World Bank, Q3 2025)",
    market: "A platform fee on every payment, then a withdrawal fee",
    till: "1% paid by the client. Free for freelancers. Gas is paid for you.",
  },
  {
    what: "Who holds the money meanwhile",
    wire: "The banks in between",
    market: "The platform, through its security period",
    till: "A public contract that can only pay you or refund the client",
  },
  {
    what: "If the client disappears",
    wire: "You chase an unpaid invoice",
    market: "You open a dispute",
    till: "You were already paid for every second you worked",
  },
];

export default function Home() {
  return (
    <NetworkProvider>
      <main>
        <section className={`wrap ${styles.top}`}>
          <h1 className={styles.h1}>Get paid every second you work.</h1>
          <div className={styles.live}>
            <LiveHero />
          </div>
          <div className={styles.pitch}>
            <p className={styles.lede}>
              Your client abroad funds a tab in AUSD, a digital dollar. While you&apos;re clocked in, your pay builds up every second on Monad and you can cash out
              whenever you like. No invoices, no ten-day wait, no wire fees.
            </p>
            <div className={styles.ctas}>
              <Link href="/open" className="btn primary">
                Open a tab
              </Link>
              <Link href="/app" className="btn">
                See your tabs
              </Link>
            </div>
            <p className={styles.note}>Sign up with a passkey or your email. No wallet app, no seed phrase, no gas. Test AUSD is one click away.</p>
          </div>
        </section>

        <section className={`wrap ${styles.stripRow}`} aria-label="Live network">
          <LiveStrip />
        </section>

        <section className={`wrap ${styles.section}`} aria-labelledby="world">
          <div className={styles.sectionHead}>
            <h2 id="world" className={styles.h2}>
              Who&apos;s on the clock right now
            </h2>
            <p className={styles.sub}>
              Three studios pay five freelancers on Monad testnet, around their own working hours. Every figure below is a real tab, read from
              the chain as you watch.
            </p>
          </div>
          <WorldClock />
        </section>

        <div className={`wrap ${styles.gap}`}>
          <Divider seed={1} />
        </div>

        <section id="how" className={`wrap ${styles.section} ${styles.tight}`}>
          <h2 className={styles.h2}>How a tab works</h2>
          <ol className={styles.steps}>
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className={`denom ${styles.stepNo}`} aria-hidden>
                  {i + 1}
                </span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={`wrap ${styles.section}`} aria-labelledby="note">
          <div className={styles.sectionHead}>
            <h2 id="note" className={styles.h2}>
              Every tab is a banknote
            </h2>
            <p className={styles.sub}>
              It prints itself while the freelancer works. Each part of it tells you something; point at one to find it on the note.
            </p>
          </div>
          <NoteAnatomy />
        </section>

        <div className={`wrap ${styles.gap}`}>
          <Divider seed={2} />
        </div>

        <section className={`wrap ${styles.section} ${styles.tight}`} aria-labelledby="arrive">
          <div className={styles.sectionHead}>
            <h2 id="arrive" className={styles.h2}>
              When the money arrives
            </h2>
            <p className={styles.sub}>The same week of work, paid three ways. Segundo pays while the work happens; the others pay once, days later.</p>
          </div>
          <ArrivalChart />
          <h3 className={styles.h3}>Side by side</h3>
          <div className={styles.table} role="table" aria-label="Bank wire, marketplace and Segundo compared">
            <div className={`${styles.row} ${styles.head}`} role="row">
              <span role="columnheader" />
              <span role="columnheader">Bank wire</span>
              <span role="columnheader">Freelance marketplace</span>
              <span role="columnheader" className={styles.tillCol}>
                Segundo
              </span>
            </div>
            {COMPARE.map((c) => (
              <div className={styles.row} role="row" key={c.what}>
                <span role="rowheader" className={styles.what}>
                  {c.what}
                </span>
                <span role="cell" data-label="Bank wire">
                  {c.wire}
                </span>
                <span role="cell" data-label="Marketplace">
                  {c.market}
                </span>
                <span role="cell" data-label="Segundo" className={styles.tillCol}>
                  {c.till}
                </span>
              </div>
            ))}
          </div>
          <p className={styles.sources}>
            Sources:{" "}
            <a href="https://remittanceprices.worldbank.org/sites/default/files/2026-04/RPW_main_report_and_annex_Q325.pdf" target="_blank" rel="noreferrer">
              World Bank Remittance Prices Worldwide, Q3 2025
            </a>
            ,{" "}
            <a href="https://www.upwork.com/resources/understanding-freelancer-payment-protection" target="_blank" rel="noreferrer">
              Upwork payment protection
            </a>
            .
          </p>
        </section>

        <section className={`wrap ${styles.section}`} aria-labelledby="ink">
          <div className={styles.sectionHead}>
            <h2 id="ink" className={styles.h2}>
              Every currency, its own ink
            </h2>
            <p className={styles.sub}>Freelancers see their pay in the money they think in. Twelve currencies so far, each printed in its own colour.</p>
          </div>
          <InkSheet />
        </section>

        <div className={`wrap ${styles.gap}`}>
          <Divider seed={3} />
        </div>

        <section className={`wrap ${styles.section} ${styles.tight} ${styles.monad}`}>
          <h2 id="monad" className={styles.h2}>
            Why this needs Monad
          </h2>
          <BlockTape />
          <div className={styles.points}>
            <div>
              <h3>Pay you can watch arrive</h3>
              <p>
                Monad makes a block about every 0.3 seconds and finalises it in about 0.6, so a payout lands while you&apos;re still looking at
                the screen. On a tab page Segundo pays out every few seconds as you watch.
              </p>
            </div>
            <div>
              <h3>Tabs that don&apos;t queue behind each other</h3>
              <p>
                Pay builds up from timestamps, so nothing is written while the clock runs, and each tab settles its own state. The one slot every
                payout shares is the escrow balance in AUSD, which Monad&apos;s optimistic execution re-runs when two land in a block.
              </p>
            </div>
            <div>
              <h3>One signature, no gas</h3>
              <p>
                You sign; Segundo&apos;s relayer submits. Deposits use an AUSD permit and transfers an AUSD transfer authorisation, so neither side
                ever holds MON.
              </p>
            </div>
          </div>
        </section>

        <section className={`wrap ${styles.section}`} aria-labelledby="sides">
          <h2 id="sides" className={styles.h2}>
            Built for both sides of the tab
          </h2>
          <div className={home.sides}>
            <div className={home.side}>
              <h3>For freelancers</h3>
              <ul>
                <li>
                  <b>No more waiting.</b> Pay lands while you work, and you can cash out at any second.
                </li>
                <li>
                  <b>No chasing invoices.</b> The budget is already in the contract before you start.
                </li>
                <li>
                  <b>Your money, your currency.</b> See every second of pay in rupees, pesos, naira or shillings.
                </li>
                <li>
                  <b>Nothing to set up.</b> Sign in with a passkey or your email; there&apos;s no wallet app and no gas.
                </li>
              </ul>
            </div>
            <div className={home.side}>
              <h3>For clients</h3>
              <ul>
                <li>
                  <b>Pay only for time worked.</b> The clock runs only while the freelancer is on it, and you can pause it at once.
                </li>
                <li>
                  <b>Hire anywhere.</b> One link onboards a freelancer in any country, with no bank details to collect.
                </li>
                <li>
                  <b>Unspent budget comes back.</b> Close the tab and every cent you didn&apos;t use returns in the same block.
                </li>
                <li>
                  <b>A record you can check.</b> Every shift and payout is on Monad, with a pay stub to match.
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section className={`wrap ${styles.section}`} aria-labelledby="money">
          <div className={styles.sectionHead}>
            <h2 id="money" className={styles.h2}>
              How Segundo makes money
            </h2>
            <p className={styles.sub}>One fee, paid by the side that is buying the time. The side doing the work keeps every second of it.</p>
          </div>
          <Money />
        </section>

        <section className={`wrap ${styles.section}`} aria-labelledby="faq">
          <h2 id="faq" className={styles.h2}>
            Questions people ask
          </h2>
          <Faq />
        </section>

        <section className={`wrap ${styles.closing}`} aria-labelledby="start">
          <div className={styles.closingArt}>
            <GrandRosette />
          </div>
          <div className={styles.closingText}>
            <h2 id="start" className={styles.closingH}>
              Your next hour could pay by the second.
            </h2>
            <p className={styles.lede}>Open a tab for someone you work with, or hire a demo freelancer and watch the note print. It takes a minute.</p>
            <div className={styles.ctas}>
              <Link href="/open" className="btn primary">
                Open a tab
              </Link>
              <Link href="/app" className="btn">
                See your tabs
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </NetworkProvider>
  );
}
