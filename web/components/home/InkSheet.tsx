"use client";

import { useMemo } from "react";
import { bandPaths, bandsFor, seedOf, wavePath } from "@/lib/guilloche";
import { useRates } from "@/lib/live";
import { useMounted } from "@/lib/mounted";
import { CURRENCIES, noteParts, type Currency } from "@/lib/money";
import styles from "./home.module.css";

const W = 440;
const H = 200;

/** A small specimen note in one currency's ink: what one hour at the given rate is worth there. */
function Specimen({ cur, usd, rates }: { cur: Currency; usd: number; rates: Record<string, number> | null }) {
  const mounted = useMounted();
  const art = useMemo(() => {
    const seed = seedOf("ink", cur.code);
    const bands = bandsFor(seed, 4).flatMap((b, i) => bandPaths(96, 100, 82, { ...b, radius: 0.5 + i * 0.15, strands: 6 }));
    const border = [0, 1, 2].flatMap((i) => [
      wavePath(16, 13, W - 32, 3.5, 18, i * 2.1),
      wavePath(16, H - 13, W - 32, 3.5, 18, i * 2.1 + 1),
      wavePath(13, 16, H - 32, 3.5, 18, i * 2.1, true),
      wavePath(W - 13, 16, H - 32, 3.5, 18, i * 2.1 + 2, true),
    ]);
    return { bands, border };
  }, [cur.code]);
  const parts = noteParts(usd, cur, rates);
  // Large amounts drop their decimals so every specimen prints on one line.
  const value = parts ? `${parts.symbol}${parts.whole}${parts.frac && parts.value < 1000 ? "." + parts.frac : ""}` : "—";
  return (
    <figure className={styles.specimen} style={{ ["--ink-c" as string]: cur.ink, ["--ink-c-night" as string]: cur.inkNight }}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.specimenArt} aria-hidden>
        <rect width={W} height={H} rx="8" className={styles.specimenPaper} />
        {mounted &&
          art.border.map((d, i) => (
            <path key={`b${i}`} d={d} fill="none" strokeWidth="0.8" className={styles.specimenInk} opacity="0.7" />
          ))}
        {mounted &&
          art.bands.map((d, i) => (
            <path key={i} d={d} fill="none" strokeWidth="0.55" className={styles.specimenInk} opacity="0.75" />
          ))}
        <circle cx="96" cy="100" r="26" className={styles.specimenMedal} />
        <text x="96" y="108" textAnchor="middle" className={styles.specimenCode}>
          {cur.code}
        </text>
      </svg>
      <figcaption className={styles.specimenFace}>
        <span className={styles.specimenName}>{cur.name}</span>
        <span className={`denom ${styles.specimenValue}`}>{value}</span>
      </figcaption>
    </figure>
  );
}

export function InkSheet({ usd = 30 }: { usd?: number }) {
  const { rates, ratesUpdated } = useRates();
  return (
    <>
      <div className={styles.sheet}>
        {CURRENCIES.map((c) => (
          <Specimen key={c.code} cur={c} usd={usd} rates={rates} />
        ))}
      </div>
      <p className={styles.sheetNote}>
        One hour at ${usd} in each currency, at today&apos;s reference rates{ratesUpdated ? ` (updated ${new Date(ratesUpdated).toUTCString().slice(5, 16)})` : ""}.
        Pay itself moves in AUSD; the note shows what it&apos;s worth where you live.
      </p>
    </>
  );
}
