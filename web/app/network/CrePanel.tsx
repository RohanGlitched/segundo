"use client";

import { useEffect, useState } from "react";
import { explorerAddress, explorerTx } from "@/lib/chain";
import styles from "./network.module.css";

/** SegundoKeeper, the contract that accepts the CRE workflow's reports (Sourcify exact match). */
const KEEPER = "0xFEf8d6A7aF00ACd33FDdd2Ef8800cab78164d80D";
/** The first broadcast run, recorded in cre/SIMULATION.md. */
const FIRST_RUN = "0x17d86a590a0ed22bc60d941db6d0b0e462a449a6f7fe48a43704d97ebe975d03";

/** GET /api/cre. Every field is optional here: the route may be older, newer or missing. */
type Cre = {
  reports?: number;
  lastBlock?: number | string;
  lastAt?: number | string;
  tabsSettledTotal?: number;
  /** AUSD base units (6 dp), as a decimal string or a number. */
  paidTotal?: string | number;
  rates?: { cur: string; rateE6: string | number }[];
  keeper?: string;
};

const units = (v: string | number | undefined) => {
  if (v == null) return null;
  try {
    return Number(BigInt(String(v))) / 1e6;
  } catch {
    const n = Number(v);
    return Number.isFinite(n) ? n / 1e6 : null;
  }
};

function when(v: number | string | undefined): string | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129_600) return `${Math.round(s / 3600)} h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The Chainlink CRE keeper's record, read from /api/cre: how many reports SegundoKeeper has accepted, the tabs those
 * reports settled, what they paid and the exchange rates they posted. Without the route it says where to check.
 */
export function CrePanel() {
  const [cre, setCre] = useState<Cre | null | undefined>(undefined);
  useEffect(() => {
    let stop = false;
    fetch("/api/cre", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: unknown) => !stop && setCre(d && typeof d === "object" && !("error" in d) ? (d as Cre) : null))
      .catch(() => !stop && setCre(null));
    return () => {
      stop = true;
    };
  }, []);

  const keeper = cre?.keeper && /^0x[0-9a-fA-F]{40}$/.test(cre.keeper) ? cre.keeper : KEEPER;
  const paid = units(cre?.paidTotal);
  const last = when(cre?.lastAt);
  const rates = (cre?.rates ?? [])
    .map((r) => ({ cur: String(r.cur).toUpperCase(), rate: units(r.rateE6) }))
    .filter((r): r is { cur: string; rate: number } => /^[A-Z]{3}$/.test(r.cur) && r.rate != null && r.rate > 0);
  const digits = (rate: number) => (rate >= 100 ? 2 : rate >= 1 ? 3 : 4);

  return (
    <aside className={`${styles.cert} ${styles.cre}`} aria-label="Chainlink CRE keeper" aria-busy={cre === undefined}>
      <div className={styles.certHead}>
        <span>Chainlink CRE keeper</span>
        <a className="serial" href={explorerAddress(keeper)} target="_blank" rel="noreferrer">
          {keeper.slice(0, 6)}…{keeper.slice(-4)}
        </a>
      </div>
      {cre ? (
        <>
          <dl className={styles.certList}>
            <div>
              <dt>Reports accepted</dt>
              <dd>{cre.reports != null ? cre.reports.toLocaleString("en-US") : "—"}</dd>
            </div>
            <div>
              <dt>Tabs settled by them</dt>
              <dd>{cre.tabsSettledTotal != null ? cre.tabsSettledTotal.toLocaleString("en-US") : "—"}</dd>
            </div>
            <div>
              <dt>Last report</dt>
              <dd>
                {cre.lastBlock != null ? <span className="serial">{Number(cre.lastBlock).toLocaleString("en-US")}</span> : "—"}
                {last ? <span className={styles.creWhen}> {last}</span> : null}
              </dd>
            </div>
            <div className={styles.certTotal}>
              <dt>Paid to freelancers</dt>
              <dd>{paid != null ? `$${paid.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</dd>
            </div>
          </dl>
          {rates.length > 0 && (
            <>
              <p className={styles.creRatesHead}>Rates the network agreed on, for one US dollar</p>
              <ul className={styles.creRates}>
                {rates.map((r) => (
                  <li key={r.cur}>
                    <span>{r.cur}</span>
                    <b>{r.rate.toLocaleString("en-US", { maximumFractionDigits: digits(r.rate) })}</b>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <p className={styles.certFoot}>
          {cre === undefined ? "Reading the keeper's record…" : "The keeper's live record isn't answering right now. Its first broadcast run settled three tabs and posted six rates: "}
          {cre === null && (
            <a className="serial" href={explorerTx(FIRST_RUN)} target="_blank" rel="noreferrer">
              {FIRST_RUN.slice(0, 10)}…{FIRST_RUN.slice(-6)}
            </a>
          )}
          {cre === null && "."}
        </p>
      )}
      <p className={styles.certFoot}>
        Testnet. The workflow runs through Chainlink&apos;s CRE simulator with broadcast, so every report is a real transaction on Monad; Segundo&apos;s own
        keeper settles too.
      </p>
    </aside>
  );
}
