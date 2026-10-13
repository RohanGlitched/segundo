import Link from "next/link";
import type { ReactNode } from "react";
import { ByAccounts } from "./ByAccounts";
import styles from "./home.module.css";

const QA: { q: string; a: ReactNode }[] = [
  {
    q: "Is this real money?",
    a: "Not yet. Segundo runs on Monad testnet with Agora's test AUSD, which has no value. The contract and the flows are the ones that would run on mainnet.",
  },
  {
    q: "Do I need a crypto wallet or any MON?",
    a: (
      <>
        No. <ByAccounts full="Sign in with a passkey or your email" mera="Sign in with a passkey" /> and Segundo creates a wallet for you. Every action
        is a signature; Segundo&apos;s relayer submits it and pays the gas.
      </>
    ),
  },
  {
    q: "What does it cost?",
    a: "Freelancers pay nothing to be paid: every second of pay reaches you in full. Clients pay 1% of what they spend. The fee is signed with each budget or top-up, in the same step and with no gas, and when you close the tab the unspent budget and its fee come back. Fund $100, use $60, and you pay $60.60 in all.",
  },
  {
    q: "How does Segundo make money?",
    a: (
      <>
        From that 1% client fee, which is already live on testnet and lands in a public treasury you can check on Monad&apos;s explorer. It pays for the
        service around the tab: no gas for either side, passkey sign-up, and cash-out as it arrives. Later, a share of the yield on budgets waiting in
        tabs and a small margin on cash-out to local banks and mobile money. The whole model, with live numbers and what gas costs us, is on{" "}
        <Link href="/business">how Segundo makes money</Link>.
      </>
    ),
  },
  {
    q: "What if the client disappears halfway through?",
    a: "Everything already paid out is in your wallet. Whatever you've earned since is still yours: it stays in the contract, which can only pay it to you (anyone can trigger that payout, and closing the tab does it too). Only budget you haven't earned can go back to the client.",
  },
  {
    q: "What stops a freelancer clocking in and doing nothing?",
    a: "The client watches the same tab live and can pause pay at any moment; the clock stops in the same block. The most either side can lose is a few seconds.",
  },
  {
    q: "How often am I paid?",
    a: "You earn every second you're on the clock. While the tab is open on someone's screen, what you've earned is paid out to your wallet every few seconds; when nobody has it open, Segundo's keeper pays it out every few minutes. Either way, anything earned and not yet paid out is locked in the contract for you.",
  },
  {
    q: "How do clients add money?",
    a: (
      <>
        On testnet, Segundo hands out free test AUSD to try it with. Or send AUSD on Monad from any wallet to your Segundo address (the{" "}
        <Link href="/app">Add money</Link> sheet in your tabs shows it with a QR code). On mainnet, a business would get AUSD from Agora, which
        issues it, by bank wire, or buy it on an exchange, then send it the same way; that route isn&apos;t live in Segundo yet.
      </>
    ),
  },
  {
    q: "How do I get money into my local currency?",
    a: (
      <>
        Your pay lands in your wallet as AUSD, a digital dollar issued by Agora. Cash-out to local banks and mobile money is the next step, through
        licensed partners in each country. <Link href="/cashout">Cash-out</Link> already shows the whole route for each country, today&apos;s rate, the
        cost and the wait, with a simulated partner on testnet; the note shows your pay in your currency as it builds.
      </>
    ),
  },
  {
    q: "Who can move the money in a tab?",
    a: "Only the contract's rules: earned pay can only go to the freelancer and unspent budget only back to the client. There is no admin key, no upgrade path and no fee switch; the 1% is a separate transfer from the client, never taken from a tab. The contract is a neutral public good: anyone can call it directly and pay their own gas. Segundo's 1% pays for the service around it, like a front end. The source is verified on Monad's explorer.",
  },
];

/** The objections people raise first; the rest wait behind "More questions". */
const FIRST = [
  "Is this real money?",
  "What does it cost?",
  "What if the client disappears halfway through?",
  "What stops a freelancer clocking in and doing nothing?",
  "Do I need a crypto wallet or any MON?",
];

function Item({ x }: { x: (typeof QA)[number] }) {
  return (
    <details className={styles.qa}>
      <summary>{x.q}</summary>
      <p>{x.a}</p>
    </details>
  );
}

export function Faq() {
  const first = FIRST.map((q) => QA.find((x) => x.q === q)!).filter(Boolean);
  const rest = QA.filter((x) => !FIRST.includes(x.q));
  return (
    <div className={styles.faq}>
      {first.map((x) => (
        <Item key={x.q} x={x} />
      ))}
      <details className={styles.more}>
        <summary>More questions ({rest.length})</summary>
        {rest.map((x) => (
          <Item key={x.q} x={x} />
        ))}
      </details>
    </div>
  );
}
