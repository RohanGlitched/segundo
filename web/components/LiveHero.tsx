"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { LiveActive, useOnScreen, useRates } from "@/lib/live";
import { settleNow } from "@/lib/relay";
import { stateOf } from "@/lib/tabs";
import { currency, formatUsd, toUsd } from "@/lib/money";
import { useNetwork } from "@/lib/network";
import { Note } from "./Note";
import { TabNote } from "./TabNote";
import styles from "./LiveHero.module.css";

/** The hero: a real tab running on Monad right now, or a clearly marked specimen if none is. */
export function LiveHero() {
  const net = useNetwork();
  const { rates } = useRates();
  // The hero note stops ticking while it is scrolled away or the tab is hidden.
  const heroRef = useRef<HTMLDivElement>(null);
  const on = useOnScreen(heroRef);
  const featured = net?.featured ?? null;

  // One real payout while the visitor watches: the featured tab is paid once, a few seconds after the
  // page opens, so the hero's "paid … ago", the receipt and the block tape all move. The relayer caps the pace.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !featured || stateOf(featured.tab, Math.floor(Date.now() / 1000)) !== "working") return;
    asked.current = true;
    const h = setTimeout(() => settleNow(featured.id).catch(() => {}), 4000);
    return () => clearTimeout(h);
  }, [featured]);

  return (
    <LiveActive active={on}>
    <div ref={heroRef} className={styles.hero}>
      {net === undefined ? (
        <>
          <div className={`skeleton ${styles.placeholder}`} aria-label="Loading a live tab" />
          {/* The caption's words are known before the tab is: print them now, so nothing below moves when it arrives. */}
          <p className={styles.caption}>
            A real tab on Monad testnet, paying out while you watch. <span className={styles.pending}>Open this tab</span>
          </p>
        </>
      ) : featured ? (
        <>
          <TabNote view={featured} profiles={net?.profiles ?? {}} engrave />
          <p className={styles.caption}>
            A real tab on Monad testnet, paying out while you watch. <Link href={`/tab/${featured.id}`}>Open this tab</Link>
          </p>
        </>
      ) : (
        <>
          <div className={styles.specimen}>
            <Note
              id={0}
              usd={20.51}
              cur={currency("PHP")}
              rates={rates}
              payee={{ name: "Ana Reyes", place: "Manila" }}
              payer={{ name: "Northwind Studio", place: "Berlin" }}
              rateUsd={30}
              hours={0.68}
              live={false}
              status="Specimen"
              engrave
            />
            <span className={styles.stamp} aria-hidden>
              Specimen
            </span>
          </div>
          <p className={styles.caption}>No tab is running this minute. Open one and it appears here.</p>
        </>
      )}
    </div>
    </LiveActive>
  );
}

export function LiveStrip() {
  const net = useNetwork();
  if (!net) return <p className={styles.strip}>{net === null ? "Monad's public RPC is busy; live numbers will return in a moment." : "Reading Monad…"}</p>;
  return (
    <p className={styles.strip}>
      Right now on Monad: <b>{net.running}</b> {net.running === 1 ? "tab" : "tabs"} running, <b>{formatUsd(toUsd(net.earned))}</b> earned across{" "}
      <b>{net.tabs}</b> {net.tabs === 1 ? "tab" : "tabs"}, block <span className="serial">{net.block.toLocaleString("en-US")}</span>.
    </p>
  );
}
