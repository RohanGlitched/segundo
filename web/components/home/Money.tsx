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
        <p className={styles.moneyLine}>paid by the client, on top of what they fund. Freelancers pay nothing.</p>
      </div>
      <div className={styles.moneyText}>
        <dl className={styles.moneyStub} aria-label="A $500 tab">
          <div>
            <dt>The client funds a tab</dt>
            <dd className="denom">$500.00</dd>
          </div>
          <div>
            <dt>Segundo fee, 1%</dt>
            <dd className="denom">$5.00</dd>
          </div>
          <div>
            <dt>The freelancer receives, for time worked</dt>
            <dd className="denom">up to $500.00</dd>
          </div>
          <div>
            <dt>The freelancer pays</dt>
            <dd className="denom">$0.00</dd>
          </div>
        </dl>
        <p className={styles.moneyNote}>
          The fee is live on testnet: it is signed in the same step as the tab and lands in a public treasury on Monad. After it come a share of the yield on
          budgets waiting in tabs, a margin on local cash-out, and later, advances against income the chain has already verified.
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
