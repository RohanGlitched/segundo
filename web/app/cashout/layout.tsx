import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cash out to local money",
  description:
    "Turn pay in AUSD into pesos, naira, shillings, rupees or reais: today's rate, who does the last step, what it costs and how long it takes. Simulated on testnet.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
