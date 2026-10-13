import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pitch deck",
  description: "Segundo in ten slides: freelancers abroad paid every second they work, in Agora's AUSD on Monad, for a 1% fee the client pays.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
