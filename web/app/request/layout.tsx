import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Request a tab",
  description: "Freelancers: set your rate and a budget, and send your client one link to open a Segundo tab. You're paid every second you work.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
