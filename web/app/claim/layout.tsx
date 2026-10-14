import type { Metadata } from "next";
import { Footer } from "@/components/Footer";

// The link's key lives after the #, which never reaches the server, so the preview card stays general.
const description = "Open the link to collect it with a passkey, right in the browser. No seed phrase, no fees. It arrives in about a second.";

export const metadata: Metadata = {
  title: "Money for you",
  description,
  robots: { index: false, follow: false },
  openGraph: { title: "Someone sent you money with Segundo", description },
  twitter: { title: "Someone sent you money with Segundo", description },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="fill">{children}</div>
      <Footer />
    </>
  );
}
