import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { EmailSpecimen } from "@/components/HeadArt";
import { PageHead } from "@/components/PageHead";
import { explorerAddress, explorerTx } from "@/lib/chain";
import styles from "../proof/lookup.module.css";

/** Segundo's refund wallet: a Privy server wallet under a Privy policy (scripts/privy-refund.mjs, lib/privy-server.ts). */
const REFUND_WALLET = "0xB6A43604330f4e678735F98f5316c7887767A941";
const REFUND_POLICY = "iu3o7gknb9qkifm4qejzohn8";
/** Test transfers, both 0.01 AUSD to Segundo's own faucet wallet: one through the refund code, one sent by Privy itself. */
const REFUND_TEST_TX = "0x75e41b565b1efb347921ecbf398c142f20e363c3aabf744629853cfae9f900d2";
const PRIVY_SENT_TX = "0x31a14dcb1e08351ae4b1261461d689bef834ef759a290f85ec2b6d7716e06a6e";

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
        <section data-nav="skip">
          <PageHead
            wideArt
            eyebrow="Accounts"
            title="How Segundo uses Privy"
            lede="Most people Segundo is for have never held a crypto wallet, and some have only an email address. Privy gives each of them a wallet behind an email sign-in, and lets Segundo send money to an email address before its owner has ever opened the app."
            art={<EmailSpecimen />}
          />
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

        <section className={styles.section} aria-labelledby="refunds">
          <h2 id="refunds" className={styles.h2}>
            Refunds from a Privy server wallet
          </h2>
          <p className={styles.sub}>
            Segundo takes 1% when a client funds a tab and gives back the part for time that was never worked when the tab closes. Those refunds are
            signed by a Privy server wallet, and Privy will only let that wallet sign small AUSD payments.
          </p>
          <dl className={styles.facts}>
            <div>
              <dt>The wallet</dt>
              <dd>
                <a className="serial" href={explorerAddress(REFUND_WALLET)} target="_blank" rel="noreferrer">
                  {REFUND_WALLET}
                </a>
                , an Ethereum wallet made with Privy&apos;s server wallet API. Its owner is an authorization key held only by Segundo&apos;s server: Privy
                acts on a request for it only when that key has signed the request. The app secret alone is refused.
              </dd>
            </div>
            <div>
              <dt>Its policy</dt>
              <dd>
                Policy <span className="serial">{REFUND_POLICY}</span>, also owned by that key, allows exactly two things: signing an AUSD transfer
                authorisation (EIP-3009) for the AUSD contract on Monad testnet (chain 10143) worth at most 50 AUSD, and sending a transaction to the
                AUSD contract on Monad testnet that transfers at most 50 AUSD and carries no MON. Everything else is denied: other chains, other
                contracts or tokens, bigger amounts, other kinds of signature, and exporting the key.
              </dd>
            </div>
            <div>
              <dt>How a refund goes</dt>
              <dd>
                Segundo asks Privy to sign the refund, checks the signature is the wallet&apos;s, and its relayer submits it to AUSD and pays the gas. The
                authorisation&apos;s nonce comes from the client&apos;s own fee payment, so AUSD itself refuses a second refund of the same fee.
              </dd>
            </div>
            <div>
              <dt>Where the money comes from</dt>
              <dd>
                Fees still go to Segundo&apos;s treasury. The Privy wallet holds a small float, and the treasury tops it up when it runs short. A refund
                over 50 AUSD (a tab over $5,000) is signed by the treasury instead.
              </dd>
            </div>
            <div>
              <dt>Seen on chain</dt>
              <dd>
                Test: 0.01 AUSD from the wallet to Segundo&apos;s own faucet wallet{" "}
                <a className="serial" href={explorerTx(REFUND_TEST_TX)} target="_blank" rel="noreferrer">
                  through the refund code
                </a>{" "}
                and 0.01 AUSD{" "}
                <a className="serial" href={explorerTx(PRIVY_SENT_TX)} target="_blank" rel="noreferrer">
                  sent by Privy itself
                </a>
                . Asked to sign 51 AUSD, or to transfer another token, Privy answers <span className="serial">policy_violation</span>. The wallet&apos;s
                float is live at <span className="serial">/api/health</span>.
              </dd>
            </div>
          </dl>
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
