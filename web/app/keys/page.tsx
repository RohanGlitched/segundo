import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Footer } from "@/components/Footer";
import { TILL, explorerAddress, monadTestnet } from "@/lib/chain";
import { DEMO_FREELANCERS } from "@/lib/demo";
import { PROMPT_FREE_LABEL } from "@/lib/mera-policy";
import { bandPaths, bandsFor, ringPath, ringsFor, seedOf } from "@/lib/guilloche";
import styles from "./keys.module.css";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const SAMPLE = DEMO_FREELANCERS[0]!;

type Family = {
  id: string;
  name: string;
  job: string;
  ink: string;
  salt: string;
  becomes: string;
  uses: ReactNode;
  apart: ReactNode;
  prompt: string;
  kept: string;
};

const FAMILIES: Family[] = [
  {
    id: "wallet",
    name: "Wallet key",
    job: "pays",
    ink: "usd",
    salt: "mera.prf.salt.v1",
    becomes: "BIP-39 entropy → m/44'/60'/0'/0/0 → secp256k1",
    uses: (
      <>
        Signs every action on a tab: opening it, clocking in, paying out, closing. The signatures go to Segundo&apos;s relayer, which submits them on Monad
        and pays the gas.
      </>
    ),
    apart: (
      <>
        It is the standard Ethereum path, so any BIP-39 wallet could open the account if the phrase were ever exported. Money needs a key every
        wallet understands; nothing else should share that exposure, so nothing else is made from it.
      </>
    ),
    prompt: `When you sign in, after 15 minutes idle, and again for any send, open or top-up over ${PROMPT_FREE_LABEL}`,
    kept: "Page memory, while you're signed in",
  },
  {
    id: "seal",
    name: "Sealing key",
    job: "your private details",
    ink: "eur",
    salt: "segundo/seal/v1",
    becomes: "HKDF-SHA-256 → AES-256-GCM",
    uses: (
      <>
        Encrypts your legal name, address, tax ID and payout account in your browser. They print on invoices and income statements only after you confirm
        with your passkey.
      </>
    ),
    apart: (
      <>
        Your details outlive any one session and any one wallet. A leaked wallet key or a stolen signature opens nothing here, and opening your details
        never needs the key that moves money.
      </>
    ),
    prompt: "Its own prompt, every time you open your details, even mid-session",
    kept: "Page memory for editing, until the session locks",
  },
  {
    id: "invite",
    name: "Invite keys",
    job: "rebuild any invite",
    ink: "inr",
    salt: "segundo/invite/v1",
    becomes: "HKDF-SHA-256 per tab → secp256k1",
    uses: (
      <>
        One key per tab you open for someone you invite by link. The contract stores its address; the link carries the private half; the freelancer
        claims the tab with a signature from it. Lose the link and your passkey makes the same key again, on any device.
      </>
    ),
    apart: (
      <>
        Invite keys travel in links you paste into chats and emails. Whoever holds one link holds that one key: it says nothing about your other invites,
        your details or your wallet.
      </>
    ),
    prompt: "Once a session, when you open or rebuild an invite",
    kept: "Page memory; the link itself in this browser",
  },
  {
    id: "disclose",
    name: "Disclosure key",
    job: "share with a landlord, only them",
    ink: "kes",
    salt: "segundo/disclose/v1",
    becomes: "HKDF-SHA-256 → X25519",
    uses: (
      <>
        Seals the details you pick for one verifier&apos;s browser: a landlord, a bank, an employer. They see them next to your on-chain income, and nobody
        else can read the reply, Segundo included.
      </>
    ),
    apart: (
      <>
        This key meets keys made by strangers. Keeping it apart means sharing with a verifier never touches the key that holds your money or the one
        that guards your stored details.
      </>
    ),
    prompt: "Every time you share: one fingerprint for it and the sealing key",
    kept: "Page memory, until the session locks",
  },
];

type Rule = { action: ReactNode; asks: "free" | "again" | "always" | "once" | "none"; why: ReactNode };

const ASKS: Record<Rule["asks"], string> = {
  free: "No prompt",
  once: "Once a session",
  again: "Asks again",
  always: "Every time",
  none: "Nothing to export",
};

/** What asks for the passkey inside an unlocked signing session. Mirrors lib/wallet.tsx (PROMPT_FREE_UNITS) and lib/seal.ts. */
const RULES: Rule[] = [
  {
    action: "Clock in, clock out, pause pay, change the rate",
    asks: "free",
    why: "The contract decides where the money goes. These only start, stop or price the clock on a tab you are already part of.",
  },
  {
    action: "Pay out what's earned, or close a tab",
    asks: "free",
    why: "Pays the freelancer only what the clock earned and sends the rest back to the client. Nothing can go to anyone else.",
  },
  {
    action: "Your name, place and currency",
    asks: "free",
    why: "Public on Monad anyway, and you can change it back at any time.",
  },
  {
    action: `Send, open a tab or top one up, up to ${PROMPT_FREE_LABEL}`,
    asks: "free",
    why: "Everyday amounts. The signing session covers them so paying feels like tapping a card.",
  },
  {
    action: `Send over ${PROMPT_FREE_LABEL}: to an address, an email, a link or a cash-out`,
    asks: "again",
    why: "The money leaves your account for someone the contract can't check. One fresh fingerprint per send.",
  },
  {
    action: `Open a tab or top one up over ${PROMPT_FREE_LABEL}`,
    asks: "again",
    why: "A large budget is committed to one person. The permit that moves it needs a fresh fingerprint.",
  },
  {
    action: "Open your sealed details, on your account or an income statement",
    asks: "always",
    why: "Your tax ID and bank account shouldn't be one tap away for whoever picks up an unlocked phone.",
  },
  {
    action: "Share details with a landlord or bank",
    asks: "always",
    why: "One fingerprint makes the disclosure key and opens your details together (two PRF salts, one prompt).",
  },
  {
    action: "Make an invite link, or rebuild one",
    asks: "once",
    why: "The invite root stays in page memory until the session locks; each tab's key is made from it.",
  },
  {
    action: "Export a key",
    asks: "none",
    why: "A passkey account has nothing stored to export: every key is computed again from the passkey. Email accounts export through Privy's own window.",
  },
];

/** The passkey as an engraved seal: the same guilloche bands the notes carry, a fingerprint at the centre. */
function Rosette() {
  const seed = seedOf("segundo", "keys");
  const bands = bandsFor(seed, 5).map((b) => bandPaths(300, 300, 280, { ...b, strands: b.strands + 2 }));
  const core = ringsFor(seed, 2).map((r, i) => ringPath(300, 300, 280 * [0.36, 0.42][i]!, { ...r, scale: 1 }));
  return (
    <svg viewBox="0 0 600 600" className={styles.rosette} aria-hidden>
      {bands.map((band, i) =>
        band.map((d, j) => (
          <path key={`${i}-${j}`} d={d} fill="none" stroke={i === 4 ? "var(--serial)" : "var(--ink)"} strokeWidth={i === 4 ? 0.8 : 0.55} opacity={i === 4 ? 0.85 : 0.5} />
        )),
      )}
      {core.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--intaglio)" strokeWidth="0.7" opacity="0.7" />
      ))}
      <circle cx="300" cy="300" r="86" fill="var(--paper)" stroke="var(--ink)" strokeWidth="2.5" />
      <g fill="none" stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round" transform="translate(300 300) scale(2.6) translate(-100 -100)">
        <path d="M83 102c3-10 9-15 17-15s14 5 17 15" />
        <path d="M88 108c0-9 5-16 12-16s12 7 12 16" />
        <path d="M93 111c0-7 3-12 7-12s7 5 7 12" />
        <path d="M100 104v10" />
      </g>
    </svg>
  );
}

function Formula({ children, label }: { children: ReactNode; label: string }) {
  return (
    <figure className={styles.formula} aria-label={label}>
      {children}
    </figure>
  );
}

export default function Keys() {
  const chain = monadTestnet.id;
  return (
    <>
      <main>
        {/* ------------------------------------------------------------ hero */}
        <section className={`wrap ${styles.top}`}>
          <div className={styles.topText}>
            <p className={styles.kicker}>Passkeys on Segundo, with Mera</p>
            <h1 className={styles.h1}>One passkey, many keys.</h1>
            <p className={styles.model}>
              Your Segundo passkey makes <b>four keys</b>, each with one job, none of them worked out from another.
            </p>
            <p className={styles.lede}>
              A passkey never leaves your phone&apos;s secure chip. When you confirm with your fingerprint, it can compute 32 bytes from a secret it keeps and a
              &ldquo;salt&rdquo; the site chooses (WebAuthn&apos;s PRF extension). Same passkey, same salt: the same bytes, on every device your passkey is
              synced to. A different salt gives unrelated bytes. Segundo uses four salts, so one passkey stands behind four separate keys, and none of them is
              ever stored anywhere.
            </p>
            <div className={styles.ctas}>
              <Link href="/app" className="btn primary">
                Make a passkey account
              </Link>
              <a href="#tree" className="btn">
                See the four keys
              </a>
            </div>
          </div>
          <Rosette />
        </section>

        {/* ------------------------------------------------------------ the tree */}
        <section className={`wrap ${styles.section}`} id="tree" aria-labelledby="tree-h">
          <div className={styles.sectionHead}>
            <h2 id="tree-h" className={styles.h2}>
              One passkey → four keys
            </h2>
            <p className={styles.sub}>Each key comes from its own PRF salt. Holding one tells you nothing about the others.</p>
          </div>
          <div className={styles.tree}>
            <div className={styles.root}>
              <span className={styles.rootDot} aria-hidden />
              <span>
                <b>Your passkey</b>
                <span className="soft"> · one fingerprint, a secret that never leaves your phone</span>
              </span>
            </div>
            <ol className={styles.branches}>
              {FAMILIES.map((f) => (
                <li key={f.id} id={f.id} className={styles.plate} style={{ ["--k" as string]: `var(--k-${f.ink})` } as CSSProperties}>
                  <p className={styles.plateName}>
                    {f.name}
                    <span className={styles.job}>{f.job}</span>
                  </p>
                  <dl className={styles.plateFacts}>
                    <div>
                      <dt>PRF salt</dt>
                      <dd>
                        sha256(<span className="serial">&ldquo;{f.salt}&rdquo;</span>)
                      </dd>
                    </div>
                    <div>
                      <dt>Becomes</dt>
                      <dd>{f.becomes}</dd>
                    </div>
                  </dl>
                  <p className={styles.uses}>{f.uses}</p>
                  <p className={styles.apart}>
                    <b>{f.id === "wallet" ? "Why only money uses it." : "Why it’s not the wallet key."}</b> {f.apart}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------------------ at a glance */}
        <section className={`wrap ${styles.section}`} aria-labelledby="glance">
          <div className={styles.sectionHead}>
            <h2 id="glance" className={styles.h2}>
              At a glance
            </h2>
            <p className={styles.sub}>What each key is for, when your passkey asks, and where it lives. None of them is ever written to disk or sent to a server.</p>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">PRF salt</th>
                <th scope="col">When your passkey asks</th>
                <th scope="col">Kept</th>
              </tr>
            </thead>
            <tbody>
              {FAMILIES.map((f) => (
                <tr key={f.id} style={{ ["--k" as string]: `var(--k-${f.ink})` } as CSSProperties}>
                  <td data-label="Key">
                    <span className={styles.swatch} aria-hidden /> <b>{f.name}</b>
                  </td>
                  <td data-label="PRF salt">
                    <span className="serial">{f.salt}</span>
                  </td>
                  <td data-label="When your passkey asks">{f.prompt}</td>
                  <td data-label="Kept">{f.kept}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* ------------------------------------------------------------ prompts */}
        <section className={`wrap ${styles.section}`} id="prompts" aria-labelledby="prompts-h">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>Signing sessions</p>
            <h2 id="prompts-h" className={styles.h2}>
              What asks for your passkey
            </h2>
            <p className={styles.sub}>
              One fingerprint opens a signing session: the wallet key stays in page memory and routine actions sign with no prompt. The session ends after
              15 minutes idle, 5 minutes in the background, or when you reload or close the page. Some actions ask again even inside it.
            </p>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Inside an unlocked session</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {RULES.map((r, i) => (
                <tr key={i}>
                  <td data-label="Action">
                    <b>{r.action}</b>
                  </td>
                  <td data-label="Inside an unlocked session">
                    <span className={`${styles.ask} ${r.asks === "free" ? styles.askFree : r.asks === "once" || r.asks === "none" ? styles.askOnce : styles.askAgain}`}>
                      {ASKS[r.asks]}
                    </span>
                  </td>
                  <td data-label="Why">{r.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.small}>
            The amount rule lives in the signer, not on the buttons: before Mera signs an AUSD transfer or permit, Segundo reads its amount, and over{" "}
            {PROMPT_FREE_LABEL} it asks the passkey for a fresh assertion that must re-derive the same account. Segundo&apos;s 1% fee rides with the open
            or top-up it belongs to. A prompt you finished in the last minute (signing in, unlocking, making an invite key) counts once, so nothing asks
            twice in a row. Email and practice wallets have no passkey and work as before.
          </p>
        </section>

        {/* ------------------------------------------------------------ invites */}
        <section className={`wrap ${styles.section}`} aria-labelledby="invite-h">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>Invite keys</p>
            <h2 id="invite-h" className={styles.h2}>
              Lose the link, not the invite.
            </h2>
            <p className={styles.sub}>
              When you invite a freelancer by link, the money waits in the contract until someone claims it with the key in that link. With a random key, a
              lost browser meant a lost invite. With a passkey account, the key is rebuilt from your passkey and Monad, on any device.
            </p>
          </div>
          <ol className={styles.steps}>
            <li>
              <span className={styles.stepNo}>1</span>
              <h3>You open the tab</h3>
              <p>
                Segundo reads how many tabs your account already has on the contract, <span className="serial">tabsOf(you).length</span>. That number is the
                new tab&apos;s slot: its place in your list, fixed forever because the list only grows.
              </p>
            </li>
            <li>
              <span className={styles.stepNo}>2</span>
              <h3>Your passkey makes the key</h3>
              <p>
                The invite key comes from your passkey&apos;s invite salt and the slot. Its address goes on Monad with the tab; its private half goes after the #
                in the link, which never reaches a server.
              </p>
            </li>
            <li>
              <span className={styles.stepNo}>3</span>
              <h3>Lost the link? Rebuild it</h3>
              <p>
                On any device, sign in with the passkey and open the tab: &ldquo;Rebuild the invite link&rdquo; finds the tab&apos;s slot on Monad, makes the
                same key, and checks its address against the one the contract holds before showing the link.
              </p>
            </li>
          </ol>
          <Formula label="How an invite key is made">
            <p>
              <span className={styles.fLabel}>invite key</span> = HKDF-SHA-256(
            </p>
            <p className={styles.fIndent}>PRF(passkey, sha256(&ldquo;segundo/invite/v1&rdquo;)),</p>
            <p className={styles.fIndent}>
              &ldquo;tab:<span className="serial">{chain}</span>:<span className="serial">{short(TILL)}</span>:<i>you</i>:<i>slot</i>&rdquo;)
            </p>
            <p className={styles.fNote}>
              Chain {chain} is Monad testnet; {short(TILL)} is the{" "}
              <a href={explorerAddress(TILL)} target="_blank" rel="noreferrer">
                Segundo contract
              </a>{" "}
              (deployed under Segundo&apos;s working name, Till). Its <span className="serial">claim</span> function checks the freelancer&apos;s signature from
              this key on chain. If a second tab landed in your list at the same moment, the rebuild tries the slots next to it and keeps only the key whose
              address matches. Nothing about the invite is stored anywhere but Monad.
            </p>
          </Formula>
          <p className={styles.small}>
            Email and practice accounts have no passkey, so their invite keys are random and kept in the browser that made them, as before.
          </p>
        </section>

        {/* ------------------------------------------------------------ disclosure */}
        <section className={`wrap ${styles.section}`} aria-labelledby="disclose-h">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>Disclosure key</p>
            <h2 id="disclose-h" className={styles.h2}>
              Show a landlord. Only them.
            </h2>
            <p className={styles.sub}>
              Segundo&apos;s income statement proves what you earned from Monad itself. A landlord or a bank also needs to know it&apos;s you. Selective
              disclosure hands them exactly the sealed details you pick, readable in their browser and nowhere else, with proof they came from the account
              on the statement.
            </p>
          </div>
          <ol className={styles.steps}>
            <li>
              <span className={styles.stepNo}>1</span>
              <h3>They ask</h3>
              <p>
                The verifier opens your statement with <span className="serial">?request=1</span>. Their browser makes a one-time key pair, keeps the private
                half, and shows a link and QR code for you.
              </p>
            </li>
            <li>
              <span className={styles.stepNo}>2</span>
              <h3>You choose and confirm</h3>
              <p>
                On your statement, tick what to share: legal name, address, tax ID, payout account. One fingerprint opens your sealed details and makes your
                disclosure key; the page seals your picks for their key alone and gives you a reply link to send back.
              </p>
            </li>
            <li>
              <span className={styles.stepNo}>3</span>
              <h3>They check</h3>
              <p>
                Their page checks that your account signed the disclosure key, decrypts the reply, and shows &ldquo;Verified details for this statement&rdquo;
                beside the totals read live from Monad. It prints with the statement.
              </p>
            </li>
          </ol>
          <Formula label="How a disclosure reply is sealed">
            <p>
              <span className={styles.fLabel}>shared</span> = X25519(your disclosure key, their one-time key)
            </p>
            <p>
              <span className={styles.fLabel}>key</span> = HKDF-SHA-256(shared, &ldquo;segundo/disclose/v1&rdquo;, both public keys)
            </p>
            <p>
              <span className={styles.fLabel}>reply</span> = AES-256-GCM(your picks), bound to the statement&apos;s address, the Monad block it was read at,
              and both keys
            </p>
            <p className={styles.fNote}>
              Your wallet key signs one line, once: &ldquo;this disclosure key belongs to account 0x…&rdquo;. The verifier recovers the signer from that
              signature and checks it is the statement&apos;s account. Change one byte of the reply, or open it against another statement or another
              request, and it doesn&apos;t open.
            </p>
          </Formula>
          <div className={styles.ctas}>
            <Link href={`/proof/${SAMPLE.address}?request=1`} className="btn">
              Try the verifier&apos;s side on a demo statement
            </Link>
          </div>
        </section>

        {/* ------------------------------------------------------------ principles */}
        <section className={`wrap ${styles.section}`} aria-labelledby="why-h">
          <div className={styles.sectionHead}>
            <h2 id="why-h" className={styles.h2}>
              Why separate keys
            </h2>
          </div>
          <ul className={styles.principles}>
            <li>
              <h3>One job per key</h3>
              <p>
                A key that pays, a key that guards, a key that travels in links, a key that talks to strangers. Each is built for its job, with the
                algorithm the job needs: secp256k1 to sign on Monad, AES-GCM to seal, X25519 to share.
              </p>
            </li>
            <li>
              <h3>A leak stays where it happens</h3>
              <p>
                Different salts give unrelated outputs: the authenticator computes each with a secret it never releases. A forwarded invite link, a
                verifier&apos;s reply, even an exported wallet phrase reveal nothing about the other keys.
              </p>
            </li>
            <li>
              <h3>Prompts match promises</h3>
              <p>
                Signing in unlocks paying. Your details open only when you confirm for them. Where the authenticator allows, one fingerprint evaluates two
                salts at once (WebAuthn&apos;s second PRF input), so sharing details is a single confirmation.
              </p>
            </li>
            <li>
              <h3>One key to keep, and your details on any device</h3>
              <p>
                No key is stored: each is computed when needed and dropped when the session locks, and your passkey, synced by your phone&apos;s password
                manager, brings every one of them back on a new device. Sealed details are the one thing that isn&apos;t a key: the ciphertext is kept in your
                browser and on Segundo&apos;s server, which can&apos;t read it, so any device you sign in on with the same passkey opens it. The backup file,
                the same ciphertext, still restores it without the server.
              </p>
            </li>
          </ul>
        </section>

        {/* ------------------------------------------------------------ who holds what */}
        <section className={`wrap ${styles.section}`} aria-labelledby="holds-h">
          <div className={styles.sectionHead}>
            <h2 id="holds-h" className={styles.h2}>
              Who holds what
            </h2>
          </div>
          <div className={styles.holds}>
            <div>
              <h3>Segundo&apos;s servers never hold</h3>
              <ul>
                <li>Your passkey&apos;s secret, or any PRF output</li>
                <li>Any of the four keys</li>
                <li>Your details open, or the key that seals them</li>
                <li>An invite link&apos;s key, or a verifier&apos;s reply</li>
              </ul>
            </div>
            <div>
              <h3>Your browser keeps</h3>
              <ul>
                <li>Which passkey is yours and your public address</li>
                <li>Your details as ciphertext, also kept on Segundo&apos;s server so a new device finds them (the backup file restores them too)</li>
                <li>Invite links you made, so you don&apos;t need to rebuild them</li>
                <li>The public signature that ties your disclosure key to your account</li>
              </ul>
            </div>
            <div>
              <h3>Monad keeps</h3>
              <ul>
                <li>Each invite key&apos;s address, until the freelancer claims the tab</li>
                <li>Your list of tabs, which gives every invite its slot</li>
                <li>Every payout, which the statement adds up</li>
              </ul>
            </div>
          </div>
          <p className={styles.small}>
            Passkey accounts are built with Mera (@category-labs/mera): its PRF calls give every key here, and a small WebAuthn client plugged into Mera asks
            for two salts in one prompt. Segundo runs on Monad testnet with test AUSD; nothing here is real money.
          </p>
        </section>

        <section className={`wrap ${styles.closing}`} aria-labelledby="close">
          <h2 id="close" className={styles.closingH}>
            One fingerprint. Every key you need, and none you have to keep.
          </h2>
          <div className={styles.ctas}>
            <Link href="/app" className="btn primary">
              Open your account
            </Link>
            <Link href="/open" className="btn">
              Open a tab with an invite
            </Link>
            <Link href={`/proof/${SAMPLE.address}`} className="btn quiet">
              See an income statement
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
