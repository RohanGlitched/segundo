import Link from "next/link";
import { FORWARDER, TILL, DOLLAR, explorerAddress } from "@/lib/chain";
import { Mark } from "./Mark";
import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.foot}>
      <div className={`wrap ${styles.inner}`}>
        <div className={styles.brand}>
          <Mark size={34} />
          <div>
            <p className={styles.word}>Segundo</p>
            <p className={styles.tag}>Get paid every second you work.</p>
            <p>Segundo runs on Monad testnet with Agora&apos;s test AUSD. Nothing here is real money.</p>
          </div>
        </div>
        <div>
          <dl className={styles.contracts}>
            <div>
              <dt>Segundo contract</dt>
              <dd>
                <a href={explorerAddress(TILL)} target="_blank" rel="noreferrer" className="serial">
                  {TILL}
                </a>
              </dd>
            </div>
            <div>
              <dt>Gasless forwarder</dt>
              <dd>
                <a href={explorerAddress(FORWARDER)} target="_blank" rel="noreferrer" className="serial">
                  {FORWARDER}
                </a>
              </dd>
            </div>
            <div>
              <dt>AUSD (Agora, testnet)</dt>
              <dd>
                <a href={explorerAddress(DOLLAR)} target="_blank" rel="noreferrer" className="serial">
                  {DOLLAR}
                </a>
              </dd>
            </div>
          </dl>
          <p className={styles.note}>Contracts deployed under Segundo&apos;s working name, Till.</p>
        </div>
        <p className={styles.links}>
          <Link href="/business">How Segundo makes money</Link>
          <Link href="/network">Measured on Monad</Link>
          <Link href="/proof">Check an income statement</Link>
          <Link href="/deck">Pitch deck</Link>
          <Link href="/privy">How we use Privy</Link>
          <a href="/segundo.apk">Android app</a>
          <a href="https://github.com/RohanGlitched/segundo" target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
          <a href="https://github.com/RohanGlitched/segundo/blob/main/VERIFY.md" target="_blank" rel="noreferrer">
            How to verify it
          </a>
        </p>
      </div>
    </footer>
  );
}
