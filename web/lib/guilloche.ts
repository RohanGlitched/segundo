/**
 * Guilloche geometry for the notes. Every tab gets its own rosette from a seed, the way every
 * banknote series has its own engraving. Rings are hypotrochoids (the spirograph curve used in
 * security printing); one ring is engraved for each hour worked.
 *
 * Curves are written as smooth cubic segments whose handles come from the curve's own derivative,
 * so a few segments per wave stay within about a tenth of a unit of the true curve. Points are
 * whole tenths, written relative to the one before, so the path strings stay short; every point
 * lands where its absolute tenth would.
 */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedOf(...parts: (string | number | bigint)[]): number {
  let h = 2166136261;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

// ---- path writing

type Pt = [number, number];
/** How far, in user units, a segment's middle may sit from the true curve. */
const TOLERANCE = 0.1;

/** A length in whole tenths, written short: 12 → "1.2", 5 → ".5", -30 → "-3". */
function num(tenths: number): string {
  const a = Math.abs(tenths);
  const s = a % 10 ? `${Math.floor(a / 10) || ""}.${a % 10}` : `${a / 10}`;
  return tenths < 0 ? `-${s}` : s;
}

/** Numbers joined with the fewest separators SVG allows ("1.2-3.5.5" is 1.2, -3.5, 0.5). */
function join(values: number[]): string {
  let out = "";
  let dot = false;
  for (const v of values) {
    const s = num(v);
    if (out && s[0] !== "-" && !(s[0] === "." && dot)) out += " ";
    out += s;
    dot = s.includes(".");
  }
  return out;
}

/** Segments needed so that every segment's middle is within TOLERANCE of the curve. */
function segments(f: (t: number) => Pt, df: (t: number) => Pt, t0: number, t1: number, start: number): number {
  let n = Math.max(2, Math.ceil(start));
  for (let pass = 0; pass < 16; pass++) {
    const h = (t1 - t0) / n;
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const a = t0 + i * h;
      const [ax, ay] = f(a);
      const [bx, by] = f(a + h);
      const [adx, ady] = df(a);
      const [bdx, bdy] = df(a + h);
      const [mx, my] = f(a + h / 2);
      // The cubic's midpoint: halfway between the ends, pushed by the difference of the end tangents.
      const ex = (ax + bx) / 2 + (h * (adx - bdx)) / 8 - mx;
      const ey = (ay + by) / 2 + (h * (ady - bdy)) / 8 - my;
      ok = ex * ex + ey * ey <= TOLERANCE * TOLERANCE;
    }
    if (ok) break;
    n = Math.ceil(n * 1.25);
  }
  return n;
}

/** SVG path through f on [t0, t1], as cubic segments with handles a third of a step along the tangent. */
function curve(f: (t: number) => Pt, df: (t: number) => Pt, t0: number, t1: number, start: number, closed: boolean): string {
  const n = segments(f, df, t0, t1, start);
  const h = (t1 - t0) / n;
  const q = (v: number) => Math.round(v * 10);
  const [x0, y0] = f(t0);
  const [dx0, dy0] = df(t0);
  let px = q(x0);
  let py = q(y0);
  const head = `M${join([px, py])}`;
  const first: number[] = [q(x0 + (dx0 * h) / 3) - px, q(y0 + (dy0 * h) / 3) - py];
  const rest: number[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i === n ? t1 : t0 + i * h;
    const [x, y] = closed && i === n ? [x0, y0] : f(t);
    const [dx, dy] = df(t);
    const ex = q(x);
    const ey = q(y);
    const seg = [q(x - (dx * h) / 3) - px, q(y - (dy * h) / 3) - py, ex - px, ey - py];
    if (i === 1) first.push(...seg);
    else rest.push(...seg);
    px = ex;
    py = ey;
  }
  // "c" for the first segment; "s" for the rest, whose first handle mirrors the last one.
  return `${head}c${join(first)}${rest.length ? `s${join(rest)}` : ""}${closed ? "z" : ""}`;
}

// ---- rings

export type Ring = { R: number; r: number; d: number; rot: number; scale: number; weight: number };

/** Fixed/rolling circle pairs that make good-looking rosettes with 5 to 13 lobes. */
const PAIRS: [number, number][] = [
  [10, 3], [11, 4], [12, 5], [13, 5], [9, 4], [14, 5], [11, 3], [13, 4], [12, 7], [15, 4], [16, 7], [10, 7],
];

export function ringsFor(seed: number, count = 7): Ring[] {
  const rnd = mulberry32(seed);
  const rings: Ring[] = [];
  for (let k = 0; k < count; k++) {
    const [R, r] = PAIRS[Math.floor(rnd() * PAIRS.length)];
    rings.push({
      R,
      r,
      d: r * (0.55 + rnd() * 0.7),
      rot: rnd() * Math.PI * 2,
      scale: 0.36 + (k / (count - 1)) * 0.62,
      weight: 0.55 + rnd() * 0.5,
    });
  }
  return rings;
}

/** SVG path for one hypotrochoid ring centred at (cx, cy) with outer radius `size * ring.scale`. */
export function ringPath(cx: number, cy: number, size: number, ring: Ring): string {
  const { R, r, d, rot } = ring;
  const k = (R - r) / r;
  const g = gcd(R, r);
  const turns = r / g;
  const s = (size * ring.scale) / (R - r + d);
  const c = Math.cos(rot) * s;
  const n = Math.sin(rot) * s;
  const f = (t: number): Pt => {
    const x = (R - r) * Math.cos(t) + d * Math.cos(k * t);
    const y = (R - r) * Math.sin(t) - d * Math.sin(k * t);
    return [cx + x * c - y * n, cy + x * n + y * c];
  };
  const df = (t: number): Pt => {
    const x = -(R - r) * Math.sin(t) - d * k * Math.sin(k * t);
    const y = (R - r) * Math.cos(t) - d * k * Math.cos(k * t);
    return [x * c - y * n, x * n + y * c];
  };
  // One petal per (R - r) / g turns of the rolling circle; start from four segments a petal.
  return curve(f, df, 0, turns * Math.PI * 2, (4 * R) / g, true);
}

// ---- waves and bands

/** A band of interlaced waves along a straight line: the engraved border of a note. */
export function wavePath(x0: number, y0: number, length: number, amp: number, period: number, phase: number, vertical = false): string {
  const w = (Math.PI * 2) / period;
  const f = (u: number): Pt => {
    const a = amp * Math.sin(u * w + phase);
    return vertical ? [x0 + a, y0 + u] : [x0 + u, y0 + a];
  };
  const df = (u: number): Pt => {
    const a = amp * w * Math.cos(u * w + phase);
    return vertical ? [a, 1] : [1, a];
  };
  return curve(f, df, 0, length, (length / period) * 3, false);
}

export type Band = { radius: number; amp: number; lobes: number; strands: number; twist: number; weight: number };

/**
 * The woven bands of a rosette, one per hour worked. Each band is several sine waves wrapped
 * round a circle with staggered phases; where they cross they make the lattice seen on notes.
 */
export function bandsFor(seed: number, count = 7): Band[] {
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const lobesChoices = [16, 18, 20, 22, 24, 26, 28, 30];
  const out: Band[] = [];
  for (let k = 0; k < count; k++) {
    out.push({
      radius: 0.37 + k * 0.094,
      amp: 0.03 + rnd() * 0.022,
      lobes: lobesChoices[Math.floor(rnd() * lobesChoices.length)]! + k * 2,
      strands: 7 + Math.floor(rnd() * 3),
      twist: rnd() * Math.PI,
      weight: 0.5 + rnd() * 0.35,
    });
  }
  return out;
}

/** One path per strand of a band. */
export function bandPaths(cx: number, cy: number, size: number, b: Band): string[] {
  const paths: string[] = [];
  const A = size * b.amp;
  const L = b.lobes;
  for (let i = 0; i < b.strands; i++) {
    const phase = b.twist + (i / b.strands) * Math.PI * 2;
    const rad = (t: number) => size * b.radius + A * Math.sin(L * t + phase) + A * 0.35 * Math.sin(3 * t + phase * 0.5);
    const drad = (t: number) => A * L * Math.cos(L * t + phase) + A * 1.05 * Math.cos(3 * t + phase * 0.5);
    const f = (t: number): Pt => {
      const r = rad(t);
      return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
    };
    const df = (t: number): Pt => {
      const r = rad(t);
      const dr = drad(t);
      return [dr * Math.cos(t) - r * Math.sin(t), dr * Math.sin(t) + r * Math.cos(t)];
    };
    paths.push(curve(f, df, 0, Math.PI * 2, L * 3, true));
  }
  return paths;
}
