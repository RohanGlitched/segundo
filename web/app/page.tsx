import Link from "next/link";
import { Footer } from "@/components/Footer";
import { LiveHero, LiveStrip } from "@/components/LiveHero";
import { ArrivalChart } from "@/components/home/ArrivalChart";
import { GrandRosette } from "@/components/home/Art";
import { BlockTape } from "@/components/home/BlockTape";
import { ByAccounts } from "@/components/home/ByAccounts";
import { Faq } from "@/components/home/Faq";
import { Money } from "@/components/home/Money";
import { NoteAnatomy } from "@/components/home/NoteAnatomy";
import { UnderLoad } from "@/components/home/UnderLoad";
import { WorldClock } from "@/components/home/WorldClock";
import { headroom } from "@/components/business/economics";
import { NetworkProvider } from "@/lib/network";
import bench from "@/public/bench.json";
import styles from "./page.module.css";

/** Gas room in the busiest block of the recorded load test (public/bench.json), the same figure /network prints. */
const room = headroom(bench.perBlock, bench.blockTime.avgMs);

const STEPS = [
  {
    who: "Client",
    title: "Open a tab",
    body: "Set an hourly rate and a budget in AUSD, Agora's digital dollar, and send the invite. Or the freelancer sends you a link with their rate on it. The budget waits in a public contract that can only pay them or refund you.",
  },
  {
    who: "Freelancer",
    title: "Clock in",
    body: "Pay builds up every second you're on the clock. Either of you can stop the clock at any moment, and the client can pause pay or close the tab.",
  },
  {
    who: "Both",
    title: "Paid as you go",
    body: "Earned pay lands in the freelancer's wallet as they work: every few seconds at first while the tab is on screen, easing to once a minute, and every 5 minutes otherwise. On mainnet: every 10 seconds, batched. Close the tab and the unspent budget, with its share of the fee, goes straight back.",
  },
];

export default function Home() {
  return (
    <NetworkProvider>
      <main>
        <section className={`wrap ${styles.top}`} data-nav="skip">
          <div className={styles.title}>
            <p className={styles.eyebrow}>Cross-border pay on Monad, in Agora&apos;s AUSD</p>
            <h1 className={styles.h1}>Get paid every second you work.</h1>
          </div>
          <div className={styles.live}>
            <LiveHero />
            <div className={styles.strip}>
              <LiveStrip />
            </div>
          </div>
          <div className={styles.pitch}>
            <p className={styles.lede}>
              Your client abroad funds a tab in digital dollars. While you&apos;re clocked in, your pay builds up every second and lands in your wallet as
              you work. No invoices, no ten-day wait. <b className={styles.fee}>Clients pay 1%. Freelancers pay nothing to be paid.</b>
            </p>
            <div className={styles.paths}>
              <div>
                <Link href="/open" className="btn primary">
                  I&apos;m hiring
                </Link>
                <span>Pay only for time worked</span>
              </div>
              <div>
                <Link href="/request" className="btn">
                  I freelance
                </Link>
                <span>Paid while you work, no fees</span>
              </div>
            </div>
            <p className={styles.note}>
              <ByAccounts
                full="Sign up with a passkey or your email, or try it without signing up."
                mera="Sign up with a passkey: your fingerprint or face, nothing else."
              />{" "}
              No wallet app, no seed phrase, no gas. Test dollars for now. Or <Link href="/send">send dollars abroad</Link> to anyone.
            </p>
          </div>
        </section>

        <section className={`wrap ${styles.section}`} aria-labelledby="world" data-nav="Live on Monad">
          <div className={styles.sectionHead}>
            <h2 id="world" className={styles.h2}>
              Who&apos;s on the clock right now
            </h2>
            <p className={styles.sub}>
              Three demo studios pay five demo freelancers on Monad testnet, in their own working hours. Every figure is a real tab, read from the chain as
              you watch.
            </p>
          </div>
          <div className={styles.liveBand}>
            <WorldClock />
            <BlockTape show="receipt" />
          </div>
        </section>

        <section id="how" className={`wrap ${styles.section}`} aria-labelledby="how-h" data-nav="How it works">
          <h2 id="how-h" className={styles.h2}>
            How a tab works
          </h2>
          <ol className={styles.steps}>
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <p className={styles.stepTop}>
                  <span className={`denom ${styles.stepNo}`} aria-hidden>
                    {i + 1}
                  </span>
                  <span className={styles.who}>{s.who}</span>
                </p>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
          <details className={styles.inspect}>
            <summary>
              <span className={styles.inspectHead}>Read the note</span>
              <span className={styles.inspectSub}>Every tab prints itself as a banknote while the freelancer works. Here is what each part tells you.</span>
            </summary>
            <div className={styles.inspectBody}>
              <NoteAnatomy />
            </div>
          </details>
        </section>

        <section className={`wrap ${styles.section}`} aria-labelledby="arrive" data-nav="Payday">
          <div className={styles.sectionHead}>
            <h2 id="arrive" className={styles.h2}>
              When the money arrives
            </h2>
            <p className={styles.sub}>The same week of work, paid three ways. Segundo pays while the work happens; the others pay once, days later.</p>
          </div>
          <ArrivalChart />
          <p className={styles.sources}>
            Sources:{" "}
            <a href="https://remittanceprices.worldbank.org/sites/default/files/2026-04/RPW_main_report_and_annex_Q325.pdf" target="_blank" rel="noreferrer">
              World Bank Remittance Prices Worldwide, Q3 2025
            </a>
            ,{" "}
            <a href="https://www.upwork.com/resources/understanding-freelancer-payment-protection" target="_blank" rel="noreferrer">
              Upwork payment protection
            </a>
            . <Link href="/business#today">Wires, marketplaces and Segundo side by side</Link>.
          </p>
        </section>

        <section className={`wrap ${styles.section} ${styles.monad}`} aria-labelledby="monad" data-nav="Why Monad">
          <div className={styles.sectionHead}>
            <h2 id="monad" className={styles.h2}>
              Why Monad, and not Base or Solana
            </h2>
            <p className={styles.sub}>
              Any fast chain can show a number counting up. Paying it out, many times a minute, to everyone on the clock at once, is the part that needs
              room. We measured it on Segundo&apos;s own contract.
            </p>
          </div>
          <div className={styles.points}>
            <div>
              <h3>Counting seconds is free anywhere</h3>
              <p>
                Pay is counted from timestamps, so the clock runs on any chain, and Base, Solana and Arbitrum all have blocks fast enough to watch. We
                don&apos;t claim the clock needs Monad.
              </p>
            </div>
            <div>
              <h3>Paying them out is the hard part</h3>
              <p>
                Every payout is a real AUSD transaction. In our test {room.payouts} payouts used {room.pct}% of one Monad block: room for about{" "}
                <b>{room.perBlock.toLocaleString("en-US")} payouts a block</b>, at a fraction of a cent each.
              </p>
            </div>
            <div>
              <h3>Built for how Monad charges</h3>
              <p>
                Monad charges the gas limit, not the gas used, so the relayer estimates every call and caps what it asks for. Payouts go out from a pool
                of keys, so one address is never the queue.
              </p>
            </div>
          </div>
          <BlockTape show="tape" />
          <UnderLoad reasons />
          <p className={styles.gasless}>
            <b>One signature, no gas.</b> You sign; Segundo&apos;s relayer submits and pays the network fee. Deposits use an AUSD permit and transfers an
            AUSD transfer authorisation, so neither side ever needs MON. <Link href="/network">The whole test, block by block</Link>.
          </p>
        </section>

        <section className={`wrap ${styles.section}`} aria-labelledby="money" data-nav="1% fee">
          <div className={styles.sectionHead}>
            <h2 id="money" className={styles.h2}>
              How Segundo makes money
            </h2>
            <p className={styles.sub}>One fee, paid by the side that is buying the time. The side doing the work keeps every second of it.</p>
          </div>
          <Money />
        </section>

        <section className={`wrap ${styles.section}`} aria-labelledby="faq" data-nav="Questions">
          <h2 id="faq" className={styles.h2}>
            Questions people ask
          </h2>
          <Faq />
        </section>

        <section className={`wrap ${styles.closing}`} aria-labelledby="start" data-nav="Start">
          <div className={styles.closingArt}>
            <GrandRosette />
          </div>
          <div className={styles.closingText}>
            <h2 id="start" className={styles.closingH}>
              Your next hour could pay by the second.
            </h2>
            <p className={styles.lede}>
              Open a tab for someone you work with, ask a client for one, or hire a demo freelancer and watch the note print. It takes a minute.
            </p>
            <div className={styles.ctas}>
              <Link href="/open" className="btn primary">
                I&apos;m hiring
              </Link>
              <Link href="/request" className="btn">
                I freelance
              </Link>
            </div>
            <p className={styles.note}>
              Or <Link href="/send">send dollars abroad</Link>, or <Link href="/app">see your tabs</Link>.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </NetworkProvider>
  );
}
