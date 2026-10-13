import Link from "next/link";
import { FORWARDER, TILL, DOLLAR, explorerAddress } from "@/lib/chain";
import { ByAccounts } from "./home/ByAccounts";
import { Mark } from "./Mark";
import styles from "./Footer.module.css";

const REPO = "https://github.com/RohanGlitched/segundo";

const CONTRACTS = [
  { label: "Segundo contract", address: TILL },
  { label: "Gasless forwarder", address: FORWARDER },
  { label: "AUSD by Agora (testnet)", address: DOLLAR },
];

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

/** The bottom of the note: who issued it, where to go next, and the serials to check it against. */
export function Footer() {
  return (
    <footer className={styles.foot}>
      <div className={`wrap ${styles.inner}`}>
        <div className={styles.top}>
          <div className={styles.brand}>
            <Mark size={44} />
            <div>
              <p className={styles.word}>Segundo</p>
              <p className={styles.tag}>Get paid every second you work.</p>
              <p className={styles.where}>Runs on Monad testnet with Agora&apos;s test AUSD. Nothing here is real money.</p>
            </div>
          </div>

          <nav className={styles.cols} aria-label="Footer">
            <div>
              <h2 className={styles.colHead}>Use it</h2>
              <ul>
                <li>
                  <Link href="/open">Open a tab</Link>
                </li>
                <li>
                  <Link href="/request">Ask a client for a tab</Link>
                </li>
                <li>
                  <Link href="/send">Send dollars abroad</Link>
                </li>
                <li>
                  <Link href="/app">Your tabs</Link>
                </li>
                <li>
                  <Link href="/cashout">Cash out to local money</Link>
                </li>
                <li>
                  <a href="/segundo.apk">Android app</a>
                </li>
              </ul>
            </div>
            <div>
              <h2 className={styles.colHead}>Learn</h2>
              <ul>
                <li>
                  <Link href="/business">How Segundo makes money</Link>
                </li>
                <li>
                  <Link href="/network">Measured on Monad</Link>
                </li>
                <li>
                  <Link href="/keys">One passkey, many keys</Link>
                </li>
                <ByAccounts
                  full={
                    <li>
                      <Link href="/privy">How we use Privy</Link>
                    </li>
                  }
                  mera={null}
                />
                <li>
                  <Link href="/deck">Pitch deck</Link>
                </li>
              </ul>
            </div>
            <div>
              <h2 className={styles.colHead}>Check it</h2>
              <ul>
                <li>
                  <Link href="/proof">Check an income statement</Link>
                </li>
                <li>
                  <a href={`${REPO}/blob/main/VERIFY.md`} target="_blank" rel="noreferrer">
                    How to verify it
                  </a>
                </li>
                <li>
                  <a href={REPO} target="_blank" rel="noreferrer">
                    Source on GitHub
                  </a>
                </li>
              </ul>
            </div>
          </nav>
        </div>

        <div className={styles.bottom}>
          <dl className={styles.serials}>
            {CONTRACTS.map((c) => (
              <div key={c.address}>
                <dt>{c.label}</dt>
                <dd>
                  <a href={explorerAddress(c.address)} target="_blank" rel="noreferrer" className="serial" title={c.address}>
                    <span className={styles.full}>{c.address}</span>
                    <span className={styles.short} aria-hidden>
                      {short(c.address)}
                    </span>
                  </a>
                </dd>
              </div>
            ))}
          </dl>

          <p className={styles.micro} aria-hidden>
            {"SEGUNDO PAYS BY THE SECOND ON MONAD ".repeat(12)}
          </p>

          <div className={styles.base}>
            <p>Monad testnet, chain 10143.</p>
            <p>
              Open source under the{" "}
              <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
                MIT licence
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
