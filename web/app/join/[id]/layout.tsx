import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { requireTabId } from "@/components/tabExists";

export const metadata: Metadata = { title: "Join a tab" };

export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  await requireTabId((await params).id);
  return (
    <>
      <div className="fill">{children}</div>
      <Footer />
    </>
  );
}
