import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { requireTabId } from "@/components/tabExists";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: /^\d+$/.test(id) ? `Tab № ${id.padStart(4, "0")}` : "Tab" };
}

export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  await requireTabId((await params).id);
  return (
    <>
      <div className="fill">{children}</div>
      <Footer />
    </>
  );
}
