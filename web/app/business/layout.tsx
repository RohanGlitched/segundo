import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How Segundo makes money",
  description:
    "Clients pay 1% on top of what they fund; freelancers pay nothing. Live fee revenue from Monad, the revenue lines after it, unit economics, the market and the competition, every number sourced.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
