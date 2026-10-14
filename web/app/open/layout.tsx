import type { Metadata } from "next";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = { title: "Open a tab" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="fill">{children}</div>
      <Footer />
    </>
  );
}
