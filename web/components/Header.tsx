"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { explorerAddress } from "@/lib/chain";
import { budgetLeft, useWallet } from "@/lib/wallet";
import { formatUsd, toUsd } from "@/lib/money";
import { shortAddress } from "@/lib/tabs";
import { InstallApp, usePwaSetup, useStandalone } from "./InstallApp";
import { Mark } from "./Mark";
import { SignInChoices } from "./ui";
import styles from "./Header.module.css";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A small popover: focus moves to its first item when it opens, Escape closes it and puts focus back on the button
 * that opened it, and it closes when a click or the keyboard's focus leaves it.
 */
function usePopover() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    // The panel renders after the button inside the same box; its first control takes focus.
    const first = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].find((el) => el !== trigger.current);
    first?.focus({ preventScroll: true });
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    const onFocus = (e: FocusEvent) => {
      const to = e.target as Node | null;
      if (to && !box.current?.contains(to)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
    };
  }, [open]);
  return { open, setOpen, box, trigger };
}

/** Signed out: "Sign in" opens the same choices as every sign-in panel, passkey first. */
function SignInMenu() {
  const wallet = useWallet();
  const standalone = useStandalone();
  const { open, setOpen, box, trigger } = usePopover();
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (!open) setPhone(false);
  }, [open]);
  // While the wallet is still waking up the button looks ready (never greyed out); a tap then opens the menu once it is.
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    if (wanted && wallet.ready) {
      setWanted(false);
      setOpen(true);
    }
  }, [wanted, wallet.ready, setOpen]);
  return (
    <div className={styles.account} ref={box}>
      <button
        ref={trigger}
        className="btn small primary"
        onClick={() => (wallet.ready ? setOpen((o) => !o) : setWanted(true))}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
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
  const { open, setOpen, box, trigger } = usePopover();
  const [copied, setCopied] = useState(false);
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (!open) setPhone(false);
  }, [open]);

  if (!wallet.address) return null;
  return (
    <div className={styles.account} ref={box}>
      <button ref={trigger} className={styles.who} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" title={wallet.address}>
        <i aria-hidden className={styles.dot} />
        <span className={styles.whoLong}>{wallet.kind === "privy" ? wallet.label : shortAddress(wallet.address)}</span>
        {/* On a small phone: the dot and the last four characters, so the chip keeps its gutter. */}
        <span className={styles.whoShort} aria-hidden>
          …{wallet.address.slice(-4)}
        </span>
        <span className="visually-hidden">, account menu</span>
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
          {wallet.kind === "mera" && wallet.unlocked && (
            <p className={styles.menuNote}>
              Signing is unlocked: {formatUsd(toUsd(budgetLeft(wallet.session)))} more before Segundo asks for your passkey again.
            </p>
          )}
          {wallet.note && <p className={styles.menuNote}>{wallet.note}</p>}
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
          {wallet.exportKey && (
            <button
              role="menuitem"
              className={styles.item}
              onClick={() => {
                void wallet.exportKey!();
                setOpen(false);
              }}
            >
              Take your key elsewhere
            </button>
          )}
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

const MENU = [
  { href: "/app", label: "Your tabs" },
  { href: "/#how", label: "How it works" },
  { href: "/business", label: "How Segundo makes money" },
  { href: "/network", label: "Measured on Monad" },
  { href: "/send", label: "Send dollars abroad" },
  { href: "/cashout", label: "Cash out to local money" },
  { href: "/proof", label: "Check an income statement" },
  { href: "/keys", label: "One passkey, many keys" },
  { href: "/deck", label: "Pitch deck" },
];

/** On narrow screens the page links fold into one menu, so every page stays one tap away. */
function MainMenu() {
  const path = usePathname();
  const { open, setOpen, box, trigger } = usePopover();
  useEffect(() => setOpen(false), [path, setOpen]);
  return (
    <div className={`${styles.account} ${styles.menuWrap}`} ref={box}>
      <button ref={trigger} className={styles.menuBtn} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="main-menu">
        <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden>
          <path d="M1 1.5h14M1 6h14M1 10.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        Menu
      </button>
      {open && (
        <div className={`${styles.menu} ${styles.mainMenu}`} id="main-menu">
          {MENU.map((m) => (
            <Link key={m.href} href={m.href} className={styles.item} aria-current={path === m.href ? "page" : undefined} onClick={() => setOpen(false)}>
              {m.label}
            </Link>
          ))}
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
          <Link href="/app" className={`${styles.link} ${styles.tabsLink}`} aria-current={path?.startsWith("/app") ? "page" : undefined}>
            Your tabs
          </Link>
          <MainMenu />
          {wallet.address ? <AccountMenu /> : <SignInMenu />}
        </nav>
      </div>
    </header>
  );
}
