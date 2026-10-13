import type { Metadata } from "next";
import { getAddress, isAddress } from "viem";
import { readProfiles } from "@/lib/tabs";

/** The person's public Segundo name in the title when Monad answers quickly; the address otherwise. */
export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  if (!isAddress(address, { strict: false })) return { title: "Income statement" };
  const a = getAddress(address);
  const profiles = await Promise.race([readProfiles([a]).catch(() => ({})), new Promise<Record<string, never>>((r) => setTimeout(() => r({}), 2_500))]);
  const name = (profiles as Record<string, { name: string; place: string }>)[a.toLowerCase()]?.name;
  const who = name || `${a.slice(0, 6)}…${a.slice(-4)}`;
  return {
    title: `Income statement: ${who}`,
    description: `Every payout ${who} received through Segundo, computed from Monad and checkable transaction by transaction.`,
    // Statements are shared on purpose, by link or QR code; they stay out of search results.
    robots: { index: false, follow: false },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
