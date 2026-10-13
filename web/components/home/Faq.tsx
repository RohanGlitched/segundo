import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./home.module.css";

const QA: { q: string; a: ReactNode }[] = [
  {
    q: "Is this real money?",
    a: "Not yet. Segundo runs on Monad testnet with Agora's test AUSD, which has no value. The contract and the flows are the ones that would run on mainnet.",
  },
  {
    q: "Do I need a crypto wallet or any MON?",
    a: "No. Sign in with a passkey or your email and Segundo creates a wallet for you. Every action is a signature; Segundo's relayer submits it and pays the gas.",
  },
  {
    q: "What does it cost?",
    a: "Freelancers pay nothing: every second of pay reaches you in full. Clients pay 1% on top of what they put into a tab, so a $100 budget costs them $101. The fee is signed in the same step as the tab, with no extra prompt and no gas.",
  },
  {
    q: "How does Segundo make money?",
    a: (
      <>
        From that 1% client fee, which is already live on testnet and lands in a public treasury you can check on Monad&apos;s explorer. Later, a share of
        the yield on budgets waiting in tabs and a small margin on cash-out to local banks and mobile money. The whole model, with live numbers, is on{" "}
        <Link href="/business">how Segundo makes money</Link>.
      </>
    ),
  },
  {
    q: "What if the client disappears halfway through?",
    a: "You've already been paid for every second up to the last payout, which happens every few seconds while the tab is open. The rest of the budget stays in the contract and can only go to you, for time on the clock, or back to the client.",
  },
  {
    q: "What stops a freelancer clocking in and doing nothing?",
    a: "The client watches the same tab live and can pause pay at any moment; the clock stops in the same block. The most either side can lose is a few seconds.",
  },
  {
    q: "How do I get money into my local currency?",
    a: "Your pay lands as AUSD, Agora's dollar stablecoin, which you can send to any exchange or wallet with one signature. Local cash-out partners are next on the roadmap; the note already shows your pay in your currency at today's rate.",
  },
  {
    q: "Who can move the money in a tab?",
    a: "Only the contract's rules: earned pay can only go to the freelancer and unspent budget only back to the client. There is no admin key, no upgrade path and no fee switch; the 1% is a separate transfer from the client, never taken from a tab. The source is verified on Monad's explorer.",
  },
];

export function Faq() {
  return (
    <div className={styles.faq}>
      {QA.map((x) => (
        <details key={x.q} className={styles.qa}>
          <summary>{x.q}</summary>
          <p>{x.a}</p>
        </details>
      ))}
    </div>
  );
}
