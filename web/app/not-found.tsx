import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { StatePage } from "@/components/StatePage";
import { GrandRosette } from "@/components/home/Art";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <>
      <main className="fill">
        <StatePage
          eyebrow="Not found"
          title="This note was never printed."
          lede="The page you followed doesn't exist. Check the link, or start from one of these."
          art={<GrandRosette />}
          actions={
            <>
              <Link href="/" className="btn primary">
                Go to the home page
              </Link>
              <Link href="/app" className="btn">
                See your tabs
              </Link>
            </>
          }
        >
          <p className="soft">
            Looking for a tab? Its address is <span className="serial">/tab/</span> and its number, like the one printed on the note. To check a
            freelancer&apos;s income, use <Link href="/proof">income statements</Link>.
          </p>
        </StatePage>
      </main>
      <Footer />
    </>
  );
}
