import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { DEMO_FREELANCERS } from "@/lib/demo";
import { LookupForm } from "./LookupForm";
import styles from "./lookup.module.css";

export const metadata: Metadata = {
  title: "Check an income statement",
  description:
    "Freelancers paid through Segundo can prove what they earned to a landlord, a bank or a visa office. Every line of the statement is a Monad transaction anyone can check.",
};

const USES = [
  {
    who: "A landlord",
    what: "A rental application asks for three months of income. The statement shows every payout in that window, who paid it, and the total in pesos, naira or rupees.",
  },
  {
    who: "A bank or lender",
    what: "Freelance income from abroad usually arrives as unexplained credits. Here each one names the client, the tab it came from and the exact block it landed in.",
  },
  {
    who: "A visa office",
    what: "Proof of steady income for a work or digital-nomad visa: earnings by month, by client, and a QR code on the printed copy that opens the live statement.",
  },
];

export default function ProofLookup() {
  return (
    <>
      <main className={`wrap ${styles.page}`}>
        <section className={styles.top}>
          <p className={styles.kicker}>Income statements</p>
          <h1 className={styles.h1}>Check a Segundo income statement</h1>
          <p className={styles.lede}>
            Freelancers paid through Segundo can show anyone exactly what they earned. Paste the account address printed on a statement, or scan its QR
            code, and the statement is rebuilt from Monad while you watch.
          </p>
          <LookupForm />
        </section>

        <section className={styles.section} aria-labelledby="for">
          <h2 id="for" className={styles.h2}>
            Proof of income without an employer
          </h2>
          <p className={styles.sub}>
            A salaried worker hands over a payslip. A freelancer in Manila, Lagos or Pune paid by studios abroad has screenshots. A Segundo statement is
            the payslip they never had, and nobody has to take their word for it.
          </p>
          <ul className={styles.uses}>
            {USES.map((u) => (
              <li key={u.who}>
                <h3>{u.who}</h3>
                <p>{u.what}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="on-it">
          <h2 id="on-it" className={styles.h2}>
            What a statement shows
          </h2>
          <dl className={styles.facts}>
            <div>
              <dt>Who</dt>
              <dd>The name, city and currency the freelancer set on their public Segundo profile, and their account address.</dd>
            </div>
            <div>
              <dt>How much</dt>
              <dd>Total received in the period (30 days, 90 days, 12 months or all time) in AUSD, Agora&apos;s dollar stablecoin, and in their own currency.</dd>
            </div>
            <div>
              <dt>When and from whom</dt>
              <dd>Earnings by day or month, a breakdown by client, and time on the clock.</dd>
            </div>
            <div>
              <dt>Every payout</dt>
              <dd>
                Each line with its date, client, tab and <span className="serial">block number</span>, linked to the transaction on MonadVision.
              </dd>
            </div>
            <div>
              <dt>Private details, only if they choose</dt>
              <dd>
                Legal name, address and tax ID can be added to a printed copy by the freelancer alone: they are sealed with their passkey and opened on
                their own device, never sent to Segundo.
              </dd>
            </div>
          </dl>
        </section>

        <section className={styles.section} aria-labelledby="checked">
          <h2 id="checked" className={styles.h2}>
            Why you can trust the numbers
          </h2>
          <ol className={styles.steps}>
            <li>
              <b>Pay only moves on chain.</b> Clients fund a tab in the Segundo contract on Monad, and the contract pays the freelancer for time on the
              clock. Through Segundo, there is no other way for the money to reach them.
            </li>
            <li>
              <b>The statement reads the chain, not a database.</b> Every payout event since the contract was deployed is read from Monad through Envio
              HyperRPC and added up when the page opens.
            </li>
            <li>
              <b>Any line can be checked by hand.</b> Click a block number and MonadVision, an independent block explorer, shows the same transfer.
            </li>
          </ol>
          <p className={styles.note}>Segundo runs on Monad testnet with test AUSD for now. The contract is deployed under Segundo&apos;s working name, Till.</p>
        </section>

        <section className={styles.section} aria-labelledby="samples">
          <h2 id="samples" className={styles.h2}>
            Sample statements
          </h2>
          <p className={styles.sub}>Our demo freelancers, run by scripts on testnet so there is always live pay to look at. Their numbers are real chain data.</p>
          <ul className={styles.samples}>
            {DEMO_FREELANCERS.map((f) => (
              <li key={f.address}>
                <Link href={`/proof/${f.address}`}>
                  <span className={styles.sampleName}>{f.name}</span>
                  <span className="soft">
                    {f.place} · {f.work}
                  </span>
                  <span className="serial">
                    {f.address.slice(0, 6)}…{f.address.slice(-4)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <Footer />
    </>
  );
}
