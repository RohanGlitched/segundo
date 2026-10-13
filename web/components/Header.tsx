"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { explorerAddress } from "@/lib/chain";
import { useWallet } from "@/lib/wallet";
import { shortAddress } from "@/lib/tabs";
import { InstallApp, usePwaSetup, useStandalone } from "./InstallApp";
import { Mark } from "./Mark";
import { SignInChoices } from "./ui";
import styles from "./Header.module.css";

/** A small popover that closes on outside click and Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
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
  return { open, setOpen, box };
}

/** Signed out: "Sign in" opens the same choices as every sign-in panel, passkey first. */
function SignInMenu() {
  const wallet = useWallet();
  const standalone = useStandalone();
  const { open, setOpen, box } = usePopover();
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (!open) setPhone(false);
  }, [open]);
  return (
    <div className={styles.account} ref={box}>
      <button className="btn small primary" onClick={() => setOpen((o) => !o)} disabled={!wallet.ready} aria-expanded={open} aria-haspopup="dialog">
        Sign in
      </button>
      {open && (
        <div className={`${styles.menu} ${styles.signMenu}`} role="dialog" aria-label={phone ? "Install Segundo on your phone" : "Sign in to Segundo"}>
          {phone ? (
            <PhoneHandoff onClose={() => setPhone(false)} />
          ) : (
            <>
              <p className={styles.signHead}>Sign in to Segundo</p>
              <SignInChoices compact onDone={() => setOpen(false)} />
              {!standalone && (
                <button className={`${styles.item} ${styles.phoneItem}`} onClick={() => setPhone(true)}>
                  Install Segundo on your phone
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** On a computer, the account menu can show the QR code that opens Segundo on a phone. */
function PhoneHandoff({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.handoff}>
      <InstallApp />
      <button className={styles.item} onClick={onClose}>
        Back
      </button>
    </div>
  );
}

/** The signed-in chip opens a small menu: your tabs, private details, the phone app, your wallet, sign out. */
function AccountMenu() {
  const wallet = useWallet();
  const router = useRouter();
  const standalone = useStandalone();
  const { open, setOpen, box } = usePopover();
  const [copied, setCopied] = useState(false);
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (!open) setPhone(false);
  }, [open]);

  if (!wallet.address) return null;
  return (
    <div className={styles.account} ref={box}>
      <button className={styles.who} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" title={wallet.address}>
        <i aria-hidden className={styles.dot} />
        {wallet.kind === "privy" ? wallet.label : shortAddress(wallet.address)}
        <span aria-hidden className={styles.caret} />
      </button>
      {open && phone && (
        <div className={`${styles.menu} ${styles.signMenu}`} role="dialog" aria-label="Install Segundo on your phone">
          <PhoneHandoff onClose={() => setPhone(false)} />
        </div>
      )}
      {open && !phone && (
        <div className={styles.menu} role="menu">
          <p className={styles.menuHead}>
            {wallet.kind === "mera" ? "Signed in with your passkey" : wallet.kind === "privy" ? "Signed in with email" : "Practice wallet in this browser"}
            <span className="serial">{shortAddress(wallet.address)}</span>
          </p>
          <Link role="menuitem" href="/app" className={styles.item} onClick={() => setOpen(false)}>
            Your tabs
          </Link>
          {wallet.kind === "mera" && (
            <Link role="menuitem" href="/app#sealed" className={styles.item} onClick={() => setOpen(false)}>
              Your private details
            </Link>
          )}
          {!standalone && (
            <button role="menuitem" className={styles.item} onClick={() => setPhone(true)}>
              Install Segundo on your phone
            </button>
          )}
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
          {wallet.kind === "mera" && wallet.unlocked && wallet.lock && (
            <button
              role="menuitem"
              className={styles.item}
              onClick={() => {
                wallet.lock?.();
                setOpen(false);
              }}
            >
              Lock now
              <span className={styles.itemNote}>Your next signature asks for your passkey again.</span>
            </button>
          )}
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
  usePwaSetup();
  return (
    <header className={styles.bar}>
      <div className={`wrap ${styles.inner}`}>
        <Link href="/" className={styles.brand} aria-label="Segundo home">
          <Mark size={30} />
          <span className={styles.word}>Segundo</span>
        </Link>
        <nav className={styles.nav} aria-label="Main">
          <Link href="/#how" className={`${styles.link} ${styles.extra}`}>
            How it works
          </Link>
          <Link href="/business" className={`${styles.link} ${styles.extra}`} aria-current={path?.startsWith("/business") ? "page" : undefined}>
            Business
          </Link>
          <Link href="/network" className={`${styles.link} ${styles.extra}`} aria-current={path?.startsWith("/network") ? "page" : undefined}>
            On Monad
          </Link>
          <Link href="/app" className={styles.link} aria-current={path?.startsWith("/app") ? "page" : undefined}>
            Your tabs
          </Link>
          {wallet.address ? <AccountMenu /> : <SignInMenu />}
        </nav>
      </div>
    </header>
  );
}
