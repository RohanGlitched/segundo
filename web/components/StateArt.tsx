"use client";

import { useMemo } from "react";
import { wavePath } from "@/lib/guilloche";
import { useMounted } from "@/lib/mounted";

/**
 * A banknote with its corner torn away: the engraved border and wave bands of every Segundo note, cut along a ragged
 * edge. For a link that arrived without the part that unlocks it.
 */
export function TornNote() {
  const mounted = useMounted();
  const bands = useMemo(
    () => Array.from({ length: 7 }, (_, i) => wavePath(20, 60 + i * 26, 360, 7 + (i % 3) * 2, 46 + i * 5, i * 1.3)),
    [],
  );
  // The tear runs from the top edge down to the right edge; the corner beside it drifts off as a separate scrap.
  const body = `M28 16 H300 L292 34 L304 48 L290 64 L302 82 L286 98 L300 114 L288 128 L306 144 L292 160 L384 160 V244 A12 12 0 0 1 372 256 H28 A12 12 0 0 1 16 244 V28 A12 12 0 0 1 28 16 Z`;
  return (
    <svg viewBox="0 0 420 280" width="100%" role="presentation">
      <defs>
        <clipPath id="torn-body">
          <path d={body} />
        </clipPath>
      </defs>
      <path d={body} fill="var(--note-paper)" stroke="var(--ink)" strokeWidth="1.5" />
      {mounted && (
        <g clipPath="url(#torn-body)">
          {bands.map((d, i) => (
            <path key={i} d={d} fill="none" stroke={i === 3 ? "var(--serial)" : "var(--ink)"} strokeOpacity={i === 3 ? 0.7 : 0.28} strokeWidth="1" />
          ))}
          <rect x="30" y="30" width="190" height="210" rx="8" fill="none" stroke="var(--ink)" strokeOpacity="0.35" />
          <circle cx="124" cy="136" r="54" fill="var(--note-paper)" stroke="var(--ink)" strokeOpacity="0.6" />
          <circle cx="124" cy="136" r="40" fill="none" stroke="var(--serial)" strokeOpacity="0.6" strokeDasharray="2 4" />
          <text x="124" y="146" textAnchor="middle" fontSize="30" fontWeight="650" fill="var(--ink)" opacity="0.7">
            ?
          </text>
        </g>
      )}
      {/* The scrap that came away, drifting off the corner. */}
      <g transform="translate(338 4) rotate(14)">
        <path d="M0 12 L-8 30 L4 44 L-10 60 L2 78 L-14 94 L0 110 L-12 124 L6 140 L-8 156 L60 156 V0 H12 Z" fill="var(--note-paper)" stroke="var(--ink)" strokeWidth="1.2" strokeOpacity="0.5" opacity="0.75" />
        <text x="26" y="40" fontSize="11" fill="var(--serial)" opacity="0.8" letterSpacing="1">
          #k=
        </text>
      </g>
      <text x="40" y="232" fontSize="12" fill="var(--serial)" letterSpacing="2.5" opacity="0.85">
        № ····
      </text>
    </svg>
  );
}
