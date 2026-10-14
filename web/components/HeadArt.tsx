import Link from "next/link";
import { DEMO_CLIENTS, DEMO_FREELANCERS } from "@/lib/demo";
import styles from "./HeadArt.module.css";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * The /proof head's right half: a statement in miniature, its parts named, so a landlord or a bank sees what they
 * will be handed before pasting an address. The amounts are left as engraved bars (a specimen, not someone's pay);
 * the link opens the real, live statement it is drawn from.
 */
export function StatementSpecimen() {
  const f = DEMO_FREELANCERS.find((x) => x.place === "São Paulo") ?? DEMO_FREELANCERS[0]!;
  const rows = DEMO_CLIENTS.slice(0, 3);
  return (
    <figure className={styles.sheet}>
      <div className={styles.sheetHead}>
        <span className={styles.sheetTitle}>Income statement</span>
        <span className={styles.stamp}>Specimen</span>
      </div>
      <p className={styles.who}>
        <span>
          <b>{f.name}</b>, {f.place}
        </span>
        <span className="serial">{short(f.address)}</span>
      </p>
      <dl className={styles.total}>
        <dt>Received, last 90 days</dt>
        <dd>
          <i className={styles.bar} style={{ width: "62%" }} />
        </dd>
      </dl>
      <ol className={styles.rows} aria-label="Payout lines">
        {rows.map((c, i) => (
          <li key={c.address}>
            <span>Paid by {c.name}</span>
            <span className="serial">block ··{["4,912", "4,377", "3,860"][i]}</span>
            <i className={styles.bar} style={{ width: `${[44, 30, 52][i]}%` }} />
          </li>
        ))}
      </ol>
      <figcaption className={styles.cap}>
        Every line is a payout on Monad, linked to its transaction.{" "}
        <Link href={`/proof/${f.address}`}>Open {f.name.split(" ")[0]}&apos;s live statement</Link>
      </figcaption>
    </figure>
  );
}

/**
 * The /privy head's right half: email sign-in as it happens, in three steps on one card. Marked as a specimen; the
 * address and code are examples.
 */
export function EmailSpecimen() {
  return (
    <figure className={styles.sheet}>
      <div className={styles.sheetHead}>
        <span className={styles.sheetTitle}>Continue with email</span>
        <span className={styles.stamp}>Specimen</span>
      </div>
      <ol className={styles.flow}>
        <li>
          <span className={styles.n}>1</span>
          <span>
            <b>Your email</b>
            <span className={styles.field}>ana@studio.example</span>
          </span>
        </li>
        <li>
          <span className={styles.n}>2</span>
          <span>
            <b>The code Privy sends</b>
            <span className={`${styles.field} ${styles.code}`}>481 297</span>
          </span>
        </li>
        <li>
          <span className={styles.n}>3</span>
          <span>
            <b>A wallet made for you</b>
            <span className={styles.wallet}>
              <i aria-hidden className={styles.dot} />
              <span className="serial">0x5C1e…a93F</span>
              <span className="soft">secured by Privy</span>
            </span>
          </span>
        </li>
      </ol>
      <figcaption className={styles.cap}>No password, nothing to install, and no gas: Segundo&apos;s relayer pays it.</figcaption>
    </figure>
  );
}
