import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { GrandRosette } from "@/components/home/Art";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className={`wrap ${styles.closing}`} style={{ paddingTop: 64, paddingBottom: 64 }}>
      <div className={styles.closingArt} style={{ maxWidth: 340 }}>
        <GrandRosette />
      </div>
      <div className={styles.closingText}>
        <h1 className={styles.closingH}>This note was never printed.</h1>
        <p className={styles.lede}>The page you followed doesn&apos;t exist. Check the link, or start from one of these.</p>
        <div className={styles.ctas}>
          <Link href="/" className="btn primary">
            Go to the home page
          </Link>
          <Link href="/app" className="btn">
            See your tabs
          </Link>
        </div>
      </div>
    </main>
  );
}
