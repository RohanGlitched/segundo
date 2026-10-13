import Link from "next/link";
import styles from "./home.module.css";

/** The business model in one screen: the fee as a denomination, the receipt it prints, and the way to the full page. */
export function Money() {
  return (
    <div className={styles.money}>
      <div className={styles.moneyFace}>
        <p className={`denom ${styles.moneyDenom}`}>
          1<span>%</span>
        </p>
        <p className={styles.moneyLine}>of what the client spends. Unspent budget and its fee come back. Freelancers pay nothing.</p>
      </div>
      <div className={styles.moneyText}>
        <dl className={styles.moneyStub} aria-label="A $500 tab, $400 of it used">
          <div>
            <dt>The freelancer is paid, for time worked</dt>
            <dd className="denom">$400.00</dd>
          </div>
          <div>
            <dt>Segundo fee: 1% of what was spent</dt>
            <dd className="denom">$4.00</dd>
          </div>
          <div>
            <dt>Back to the client at close: $100 unspent, and its $1 fee</dt>
            <dd className="denom">$101.00</dd>
          </div>
          <div>
            <dt>The freelancer pays</dt>
            <dd className="denom">$0.00</dd>
          </div>
        </dl>
        <p className={styles.moneyNote}>
          A $500 tab with $400 used. The fee is live on testnet: it is signed in the same step as the tab and lands in a public treasury on Monad. The tab
          contract itself has no fee switch, and anyone can use it directly; the 1% pays for the gasless, passkey and cash-out service around it. After it
          come a share of the yield on budgets waiting in tabs, a margin on local cash-out, and later, advances against income the chain has already
          verified.
        </p>
        <p className={styles.moneyLinks}>
          <Link href="/business" className="btn primary">
            How Segundo makes money
          </Link>
          <Link href="/deck" className="btn">
            The pitch deck
          </Link>
        </p>
      </div>
    </div>
  );
}
