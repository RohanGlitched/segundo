import { ringPath } from "@/lib/guilloche";

/**
 * Segundo's mark: a seconds dial engraved like a banknote rosette. The seconds already worked
 * are printed in serial red, and a red railway seconds hand sweeps over the engraving.
 * Three cuts of the same drawing, so it stays crisp from a 16 px tab icon up to a note:
 * 0 (under 28 px) ring, five-lobe rosette and hand; 1 (under 72 px) adds a woven guilloche
 * band; 2 is the full engraving with sixty second ticks.
 * Geometry is in a 100 × 100 box; scripts/brand.cjs renders the PNG icons from this same file.
 */

export type MarkTone = "ink" | "serial";
export type MarkPart = { d: string; tone: MarkTone; w: number; fill?: boolean; round?: boolean };
export type MarkLevel = 0 | 1 | 2;

/** Where the hand rests: ten seconds past, so the mark reads as time running, not noon. */
const SECONDS = 10;

const f = (n: number) => n.toFixed(2);
const at = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [50 + r * Math.sin(a), 50 - r * Math.cos(a)] as const;
};
const circle = (r: number, cx = 50, cy = 50) =>
  `M${f(cx - r)} ${f(cy)}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0Z`;
const line = (deg: number, r0: number, r1: number) => {
  const [x0, y0] = at(deg, r0);
  const [x1, y1] = at(deg, r1);
  return `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`;
};

/** Interlaced sine strands wrapped round a circle: the woven border of a note, closed into a ring. */
function band(radius: number, amp: number, lobes: number, strands: number, w: number): MarkPart[] {
  const out: MarkPart[] = [];
  const steps = lobes * 16;
  for (let s = 0; s < strands; s++) {
    const phase = (s / strands) * Math.PI * 2;
    let d = "";
    for (let j = 0; j <= steps; j++) {
      const t = (j / steps) * Math.PI * 2;
      const r = radius + amp * Math.sin(lobes * t + phase);
      d += `${j ? "L" : "M"}${f(50 + r * Math.cos(t))} ${f(50 + r * Math.sin(t))}`;
    }
    out.push({ d: d + "Z", tone: "ink", w });
  }
  return out;
}

const rosette = (size: number, R: number, r: number, d: number, rot: number, w: number): MarkPart => ({
  d: ringPath(50, 50, size, { R, r, d, rot, scale: 1, weight: 1 }),
  tone: "ink",
  w,
});

function hand(level: MarkLevel): MarkPart[] {
  const deg = SECONDS * 6;
  const tip = [43, 43, 45][level]!;
  const tail = [0, 8, 10][level]!;
  const [lx, ly] = at(deg, [28, 28, 30][level]!);
  return [
    { d: line(deg + 180, tail, 0) + line(deg, 0, tip).replace("M", "L"), tone: "serial", w: [8, 5, 2.4][level]!, round: true },
    { d: circle([10, 8, 5.4][level]!, lx, ly), tone: "serial", w: 0, fill: true },
    { d: circle([7, 5.5, 3.4][level]!), tone: "serial", w: 0, fill: true },
  ];
}

function build(level: MarkLevel): MarkPart[] {
  const parts: MarkPart[] = [];
  if (level === 0) {
    parts.push({ d: circle(44), tone: "ink", w: 8 });
    parts.push(rosette(30, 5, 2, 2.6, 0.3, 4));
  } else if (level === 1) {
    parts.push({ d: circle(46), tone: "ink", w: 4.5 });
    parts.push(...band(30, 5.5, 10, 2, 2));
    parts.push(rosette(17, 5, 2, 2.6, 0.3, 1.8));
  } else {
    parts.push({ d: circle(48.5), tone: "ink", w: 1.2 });
    let fine = "";
    let bold = "";
    let paid = "";
    for (let i = 0; i < 60; i++) {
      const five = i % 5 === 0;
      const tick = line(i * 6, five ? 40 : 42.5, 46);
      if (i > 0 && i <= SECONDS) paid += tick;
      else if (five) bold += tick;
      else fine += tick;
    }
    parts.push({ d: fine, tone: "ink", w: 0.8 }, { d: bold, tone: "ink", w: 1.8 });
    // The paid seconds: fine ticks, and the five-second tick, all in serial red.
    parts.push({ d: paid, tone: "serial", w: 1.1 }, { d: line(SECONDS * 6, 40, 46), tone: "serial", w: 1.8 });
    parts.push(...band(35.5, 1.6, 40, 4, 0.35));
    parts.push(rosette(33, 24, 7, 4.5, 0, 0.4), rosette(33, 24, 7, 7, 0.13, 0.4), rosette(17, 18, 5, 3.5, 0, 0.4));
  }
  return [...parts, ...hand(level)];
}

const CUTS: Record<MarkLevel, MarkPart[]> = { 0: build(0), 1: build(1), 2: build(2) };

export const markLevel = (px: number): MarkLevel => (px < 28 ? 0 : px < 72 ? 1 : 2);
export const markParts = (level: MarkLevel): MarkPart[] => CUTS[level];

/**
 * The mark's <path> elements in any two inks (CSS variables on the site, hex in image routes).
 * A plain array, not a component, because the image renderer only walks real SVG elements.
 */
export function markPaths(level: MarkLevel, ink: string, serial: string) {
  return CUTS[level].map((p, i) => (
    <path
      key={i}
      d={p.d}
      fill={p.fill ? (p.tone === "ink" ? ink : serial) : "none"}
      stroke={p.fill ? "none" : p.tone === "ink" ? ink : serial}
      strokeWidth={p.fill ? undefined : p.w}
      strokeLinecap={p.round ? "round" : undefined}
    />
  ));
}

export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden style={{ flex: "none" }}>
      {markPaths(markLevel(size), "currentColor", "var(--serial)")}
    </svg>
  );
}
