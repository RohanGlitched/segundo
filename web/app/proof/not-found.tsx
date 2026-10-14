import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import styles from "./[address]/statement.module.css";

export const metadata: Metadata = { title: "Not a Monad address", robots: { index: false, follow: false } };

/** /proof/<anything that isn't an address>: a 404, with the same friendly words the statement page used to show. */
export default function NotFound() {
  return (
    <>
      <main className={`wrap ${styles.page}`}>
        <h1 className={styles.missing}>That isn&apos;t a Monad address.</h1>
        <p>
          <Link href="/proof">Check a Segundo income statement</Link> by pasting the address it was issued for.
        </p>
      </main>
      <Footer />
    </>
  );
}
