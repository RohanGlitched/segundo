import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Send dollars abroad",
  description:
    "Send digital dollars (Agora's AUSD) to the Philippines, Nigeria, India, Kenya, Brazil and more: by link, email or address, signed with a passkey, landed on Monad in about a second, no fee to send. Testnet.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
