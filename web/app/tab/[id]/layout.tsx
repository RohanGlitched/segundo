import type { Metadata } from "next";
import { Footer } from "@/components/Footer";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: /^\d+$/.test(id) ? `Tab № ${id.padStart(4, "0")}` : "Tab" };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Footer />
    </>
  );
}
