"use client";

import { useMemo } from "react";
import { bandPaths, bandsFor, ringPath, ringsFor, seedOf, wavePath } from "@/lib/guilloche";
import { useMounted } from "@/lib/mounted";
import styles from "./home.module.css";

/** A strip of interlaced waves between sections: the same engraved border every note carries. */
export function Divider({ seed = 0 }: { seed?: number }) {
  const paths = [0, 1, 2, 3].map((i) => wavePath(0, 12, 1600, 6 + (i % 2) * 2, 44 + seed * 3, i * 1.6 + seed));
  return (
    <div className={styles.divider} aria-hidden>
      <svg viewBox="0 0 1600 24" preserveAspectRatio="none">
        {paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={i === 3 ? "var(--serial)" : "var(--ink)"} strokeOpacity={i === 3 ? 0.55 : 0.28} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </div>
  );
}

/** The closing rosette: every band of a full day's work, engraved at poster size. */
export function GrandRosette() {
  const mounted = useMounted();
  const { bands, core } = useMemo(() => {
    const seed = seedOf("till", "grand");
    return {
      bands: bandsFor(seed, 7).map((b) => bandPaths(300, 300, 280, { ...b, strands: b.strands + 3 })),
      core: ringsFor(seed, 3).map((r, i) => ringPath(300, 300, 280 * [0.2, 0.27, 0.33][i]!, { ...r, scale: 1 })),
    };
  }, []);
  if (!mounted) return <svg viewBox="0 0 600 600" className={styles.grand} aria-hidden />;
  return (
    <svg viewBox="0 0 600 600" className={styles.grand} aria-hidden>
      {bands.map((band, i) =>
        band.map((d, j) => (
          <path key={`${i}-${j}`} d={d} fill="none" stroke={i === 6 ? "var(--serial)" : "var(--ink)"} strokeWidth={i === 6 ? 0.7 : 0.5} opacity={i === 6 ? 0.9 : 0.55} />
        )),
      )}
      {core.map((d, i) => (
        <path key={`c${i}`} d={d} fill="none" stroke="var(--ink)" strokeWidth="0.7" opacity="0.8" />
      ))}
      <circle cx="300" cy="300" r="44" fill="var(--paper)" stroke="var(--ink)" strokeWidth="1.2" />
    </svg>
  );
}
