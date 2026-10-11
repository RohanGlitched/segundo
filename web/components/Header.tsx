"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { explorerAddress } from "@/lib/chain";
import { useWallet } from "@/lib/wallet";
import { shortAddress } from "@/lib/tabs";
import { Mark } from "./Mark";
import styles from "./Header.module.css";

/** The signed-in chip opens a small menu: your tabs, your wallet on the explorer, copy address, sign out. */
function AccountMenu() {
  const wallet = useWallet();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!wallet.address) return null;
  return (
    <div className={styles.account} ref={box}>
      <button className={styles.who} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" title={wallet.address}>
        <i aria-hidden className={styles.dot} />
        {wallet.kind === "privy" && wallet.method === "email" ? wallet.label : shortAddress(wallet.address)}
        <span aria-hidden className={styles.caret} />
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <p className={styles.menuHead}>
            {wallet.kind === "privy" ? (wallet.method === "passkey" ? "Signed in with a passkey" : "Signed in with email") : "Practice wallet in this browser"}
            <span className="serial">{shortAddress(wallet.address)}</span>
          </p>
          <Link role="menuitem" href="/app" className={styles.item} onClick={() => setOpen(false)}>
            Your tabs
          </Link>
          <button
            role="menuitem"
            className={styles.item}
            onClick={() =>
              navigator.clipboard?.writeText(wallet.address!).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? "Address copied" : "Copy wallet address"}
          </button>
          <a role="menuitem" className={styles.item} href={explorerAddress(wallet.address)} target="_blank" rel="noreferrer">
            View wallet on MonadVision
          </a>
          <button
            role="menuitem"
            className={`${styles.item} ${styles.out}`}
            onClick={() => {
              setOpen(false);
              wallet.signOut();
              router.push("/");
            }}
          >
            Sign out
          </button>
          {wallet.kind === "practice" && <p className={styles.menuNote}>Your practice wallet stays in this browser. To get it back, choose &ldquo;Use a practice wallet&rdquo; on any sign-in panel.</p>}
        </div>
      )}
    </div>
  );
}

export function Header() {
  const wallet = useWallet();
  const path = usePathname();
  return (
    <header className={styles.bar}>
      <div className={`wrap ${styles.inner}`}>
        <Link href="/" className={styles.brand} aria-label="Till home">
          <Mark size={30} />
          <span className={styles.word}>Till</span>
        </Link>
        <nav className={styles.nav} aria-label="Main">
          <Link href="/#how" className={styles.link}>
            How it works
          </Link>
          <Link href="/app" className={styles.link} aria-current={path?.startsWith("/app") ? "page" : undefined}>
            Your tabs
          </Link>
          {wallet.address ? (
            <AccountMenu />
          ) : (
            <button className="btn small primary" onClick={wallet.privyEnabled ? wallet.signIn : wallet.usePractice} disabled={!wallet.ready}>
              Sign in
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
