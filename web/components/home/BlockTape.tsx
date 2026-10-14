"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { explorerTx } from "@/lib/chain";
import { LiveActive, useChainNow, useLive, useOnScreen } from "@/lib/live";
import { ago, currency, formatMoney, formatUsd, toUsd } from "@/lib/money";
import { useNetwork } from "@/lib/network";
import styles from "./home.module.css";

type Seen = { number: number; at: number };

/**
 * Monad's blocks as they arrive, one tick each, with the blocks that carried a Segundo payout marked
 * in serial red, and a receipt tape of the latest real payouts. `show` draws one of the two on its own.
 */
export function BlockTape({ show = "both" }: { show?: "both" | "tape" | "receipt" }) {
  // Off screen (or in a background tab) the tape stops following blocks and the clock; it catches up on return.
  const ref = useRef<HTMLDivElement>(null);
  const on = useOnScreen(ref);
  return (
    <LiveActive active={on}>
      <Tape show={show} wrapRef={ref} />
    </LiveActive>
  );
}

function Tape({ show, wrapRef }: { show: "both" | "tape" | "receipt"; wrapRef: RefObject<HTMLDivElement | null> }) {
  const { head, rates } = useLive();
  const net = useNetwork();
  const now = useChainNow();
  const [seen, setSeen] = useState<Seen[]>([]);
  const last = useRef(0);
  const first = useRef<Seen | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  // On its own the tape runs the full width of the page, so it keeps more blocks.
  const keep = show === "tape" ? 130 : 48;

  useEffect(() => {
    if (!head || head.number <= last.current) return;
    const from = last.current ? Math.max(last.current + 1, head.number - keep) : head.number - keep;
    last.current = head.number;
    if (!first.current) first.current = { number: head.number, at: Date.now() };
    else {
      const secs = (Date.now() - first.current.at) / 1000;
      if (secs > 4) setRate((head.number - first.current.number) / secs);
    }
    setSeen((old) => {
      const add: Seen[] = [];
      for (let n = from; n <= head.number; n++) add.push({ number: n, at: Date.now() });
      return [...old, ...add].slice(-keep);
    });
  }, [head, keep]);

  const paidBlocks = new Set(net?.recent.map((r) => r.block) ?? []);

  return (
    <div ref={wrapRef} className={`${styles.tapeWrap} ${show !== "both" ? styles.tapeOne : ""}`}>
      {show !== "receipt" && (
      <>
      <div className={styles.blocks} role="img" aria-label="Monad blocks as they arrive, newest on the right; the red ones carried a Segundo payout.">
        {seen.map((b) => (
          <span key={b.number} className={`${styles.block} ${paidBlocks.has(b.number) ? styles.blockPaid : ""}`} title={`Block ${b.number}`} />
        ))}
      </div>
      <p className={styles.blockMeta}>
        {head ? (
          <>
            Block <span className="serial">{head.number.toLocaleString("en-US")}</span>
            {rate ? `: ${rate.toFixed(1)} blocks a second since you opened this page` : ""}.
          </>
        ) : (
          "Listening for Monad blocks…"
        )}
      </p>
      </>
      )}

      {show !== "tape" && (
      <div className={styles.receipt} role="group" aria-label="Latest payouts">
        <p className={styles.receiptHead}>Latest payouts on Segundo</p>
        {net === undefined ? (
          <p className={styles.receiptLine}>Reading the chain…</p>
        ) : !net || net.recent.length === 0 ? (
          <p className={styles.receiptLine}>No payouts in the last few minutes. Open a tab and yours will print here.</p>
        ) : (
          net.recent.map((r) => {
            const p = net.profiles[r.payee.toLowerCase()];
            const cur = currency(p?.currency);
            const usd = toUsd(BigInt(r.amount));
            return (
              <a key={`${r.hash}-${r.id}`} href={explorerTx(r.hash)} target="_blank" rel="noreferrer" className={styles.receiptLine}>
                <span>
                  {rates ? formatMoney(usd, cur, rates) : formatUsd(usd, 4)} to {p?.name || "a freelancer on Segundo"}
                  {p?.name && p.place ? `, ${p.place}` : ""}
                </span>
                <span className="serial">
                  block {r.block.toLocaleString("en-US")}{r.time ? `, ${ago(now - r.time)}` : ""}
                </span>
              </a>
            );
          })
        )}
      </div>
      )}
    </div>
  );
}
