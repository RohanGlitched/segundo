"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { LiveActive, useHead, useOnScreen } from "@/lib/live";
import { formatUsd, toUsd } from "@/lib/money";
import { useNetwork } from "@/lib/network";
import styles from "./Footer.module.css";

type Totals = { tabs: number; paid: bigint };

/**
 * The base row's live chip: the newest Monad block, and how many tabs Segundo has run and paid out.
 * Read once, when the footer first comes into view (the home page already has the numbers, so it reuses them).
 */
export function FooterLive() {
  const ref = useRef<HTMLParagraphElement>(null);
  const on = useOnScreen(ref, "120px");
  return (
    <LiveActive active={on}>
      <Chip boxRef={ref} />
    </LiveActive>
  );
}

function Chip({ boxRef }: { boxRef: RefObject<HTMLParagraphElement | null> }) {
  const net = useNetwork();
  const head = useHead();
  const [read, setRead] = useState<Totals | null>(null);
  const asked = useRef(false);
  // useOnScreen starts out true, so the first read waits for the footer to really scroll into view.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || net || asked.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting || asked.current) return;
        asked.current = true;
        io.disconnect();
        fetch("/api/live")
          .then((r) => r.json())
          .then((d: { tabs?: number; paid?: string }) => d.tabs != null && setRead({ tabs: d.tabs, paid: BigInt(d.paid ?? "0") }))
          .catch(() => {});
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [boxRef, net]);
  const totals: Totals | null = net ? { tabs: net.tabs, paid: net.paid } : read;
  const block = head?.number ?? net?.block ?? null;
  return (
    <p ref={boxRef} className={styles.live}>
      <i aria-hidden className={block ? styles.liveDot : undefined} />
      <span>Monad testnet, chain 10143</span>
      {block != null && (
        <span>
          block <span className="serial">{block.toLocaleString("en-US")}</span>
        </span>
      )}
      {totals && (
        <span>
          {totals.tabs.toLocaleString("en-US")} tabs, {formatUsd(toUsd(totals.paid), 0)} paid out
        </span>
      )}
    </p>
  );
}

/** A small copy button beside a contract serial. */
export function CopyAddress({ address, label }: { address: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={styles.copy}
      aria-label={done ? `${label} address copied` : `Copy the ${label} address`}
      title={done ? "Copied" : "Copy address"}
      onClick={() =>
        navigator.clipboard?.writeText(address).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        {done ? (
          <path d="M3 7.4 5.8 10 11 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <>
            <rect x="4.5" y="4.5" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M9.5 2.5h-6a1 1 0 0 0-1 1v6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </>
        )}
      </svg>
    </button>
  );
}
