import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Segundo on Monad, measured",
  description:
    "A load test on Monad testnet: 96 tabs paid every second from 16 sender keys, 96 payouts in a single block, then the same payouts from one key. Every number from the run, with the transactions to check it.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
