import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import styles from "../proof/lookup.module.css";

export const metadata: Metadata = {
  title: "How Segundo uses Privy",
  description:
    "Email sign-in with a wallet made for you, gasless signing, and sending AUSD to someone by email before they have ever opened Segundo: what Privy does inside Segundo.",
};

const USES = [
  {
    who: "An email code, and a wallet made for you",
    what: "Type the code Privy emails you and you are in, with no password and nothing to install. Your wallet is created and secured by Privy; Segundo never sees its key.",
  },
  {
    who: "Signing without pop-ups or gas",
    what: "Clocking in, opening a tab or cashing out is a signature from that wallet. Segundo's relayer sends it to Monad and pays the gas, so you never need MON.",
  },
  {
    who: "Money sent to an email address",
    what: "Pay someone who has never heard of Segundo. Privy makes their wallet ahead of time, the AUSD lands in it, and it is waiting the first time they sign in.",
  },
];

export default function PrivyPage() {
  return (
    <>
      <main className={`wrap ${styles.page}`}>
        <section className={styles.top}>
          <p className={styles.kicker}>Accounts</p>
          <h1 className={styles.h1}>How Segundo uses Privy</h1>
          <p className={styles.lede}>
            Most people Segundo is for have never held a crypto wallet, and some have only an email address. Privy gives each of them a wallet behind an
            email sign-in, and lets Segundo send money to an email address before its owner has ever opened the app.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="does">
          <h2 id="does" className={styles.h2}>
            What Privy does in Segundo
          </h2>
          <p className={styles.sub}>Passkeys are the main way in (through Mera). Email through Privy is the second, and the only way to reach someone who isn&apos;t here yet.</p>
          <ul className={styles.uses}>
            {USES.map((u) => (
              <li key={u.who}>
                <h3>{u.who}</h3>
                <p>{u.what}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="email">
          <h2 id="email" className={styles.h2}>
            Sending AUSD to an email address
          </h2>
          <ol className={styles.steps}>
            <li>
              <b>You type their email instead of a wallet address.</b> Segundo checks it looks like a real address before anything else happens.
            </li>
            <li>
              <b>Segundo asks Privy for that email&apos;s wallet.</b> If the person already has a Privy account with Segundo, Privy returns its wallet.
              If not, Privy creates an account for that email now, with a wallet made in advance, and returns its address.
            </li>
            <li>
              <b>The AUSD moves on Monad.</b> You sign one transfer; the relayer submits it and pays the gas. It lands in about a second.
            </li>
            <li>
              <b>They sign in with that email, and the money is there.</b> Privy emails them a code, opens the account it made for them, and the
              wallet already holds what you sent. Nobody had to share a wallet address first.
            </li>
          </ol>
          <p className={styles.note}>
            Segundo&apos;s server doesn&apos;t store the email: it passes it to Privy at the moment you send, and lookups are rate limited so the feature can&apos;t
            be used to test lists of addresses.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="under">
          <h2 id="under" className={styles.h2}>
            Under the hood
          </h2>
          <dl className={styles.facts}>
            <div>
              <dt>In the app</dt>
              <dd>
                Privy&apos;s React SDK: email login, the embedded Ethereum wallet (made on first sign-in if the person doesn&apos;t have one), and its
                provider for signing EIP-712 typed data, the forwarded requests and AUSD permits Segundo relays.
              </dd>
            </div>
            <div>
              <dt>On the server</dt>
              <dd>
                Privy&apos;s REST API, called from one route with the app secret: <span className="serial">POST /v1/users/email/address</span> to find a
                person, <span className="serial">POST /v1/users</span> with a pregenerated Ethereum wallet to create one, and{" "}
                <span className="serial">POST /v1/users/&#123;id&#125;/wallets</span> if an existing account has no wallet yet.
              </dd>
            </div>
            <div>
              <dt>Who holds the key</dt>
              <dd>Privy. Segundo&apos;s servers never receive it, and Segundo can&apos;t move money from a Privy wallet without its owner&apos;s signature.</dd>
            </div>
            <div>
              <dt>Without Privy</dt>
              <dd>
                The passkey-only site at mera.segundo.world doesn&apos;t load Privy at all: there, a Mera passkey is the whole account. Same passkey, same
                account as segundo.world.
              </dd>
            </div>
          </dl>
          <p className={styles.note}>Segundo runs on Monad testnet with test AUSD for now.</p>
          <p>
            <Link className="btn primary" href="/app">
              Open Segundo
            </Link>
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
