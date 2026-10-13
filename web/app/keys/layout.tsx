import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "One passkey, many keys",
  description:
    "How one Segundo passkey makes four separate keys: the wallet key that pays, the sealing key for your private details, invite keys you can rebuild on any device, and a disclosure key that shares details with a landlord and only them.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
