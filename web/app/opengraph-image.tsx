import { ImageResponse } from "next/og";
import { markPaths } from "@/components/Mark";
import { bandPaths, bandsFor, ringPath, ringsFor, seedOf, wavePath } from "@/lib/guilloche";

export const alt = "Segundo: get paid every second you work";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Google Fonts serves TrueType to clients that don't announce woff2 support, which is what Satori reads.
const archivo = (axes: string) =>
  fetch(`https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@${axes}`)
    .then((r) => r.text())
    .then((css) => css.match(/src: url\((.+?)\)/)?.[1])
    .then((url) => (url ? fetch(url).then((r) => r.arrayBuffer()) : null))
    .catch(() => null);

/** A banknote: woven border, the note's rosette with the Segundo dial in its medallion, and the promise. */
export default async function OG() {
  const seed = seedOf("segundo", "1");
  const cx = 900;
  const cy = 315;
  const bands = bandsFor(seed, 7).flatMap((b) => bandPaths(cx, cy, 250, b));
  const core = ringsFor(seed, 2).map((r, i) => ringPath(cx, cy, 250 * (i ? 0.33 : 0.29), { ...r, scale: 1 }));
  const waves = [0, 1, 2].flatMap((i) => [wavePath(30, 26, 1140, 7, 34, i * 2.1), wavePath(30, 604, 1140, 7, 34, i * 2.1 + 1)]);
  const [wide, text, semi] = await Promise.all([archivo("125,750"), archivo("100,400"), archivo("87,600")]);
  const fonts = [
    wide && { name: "Archivo Expanded", data: wide, weight: 700 as const },
    text && { name: "Archivo", data: text, weight: 400 as const },
    semi && { name: "Archivo Semi", data: semi, weight: 600 as const },
  ].filter((f) => !!f);

  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: "flex", background: "#EDF1EC", position: "relative", fontFamily: "Archivo" }}>
        <svg width="1200" height="630" viewBox="0 0 1200 630" style={{ position: "absolute", left: 0, top: 0 }}>
          {waves.map((d, i) => (
            <path key={`w${i}`} d={d} fill="none" stroke="#2557B0" strokeWidth="1.2" opacity="0.7" />
          ))}
          {bands.map((d, i) => (
            <path key={i} d={d} fill="none" stroke={i < bands.length - 8 ? "#2557B0" : "#C0266D"} strokeWidth="0.8" opacity="0.8" />
          ))}
          {core.map((d, i) => (
            <path key={`c${i}`} d={d} fill="none" stroke="#2557B0" strokeWidth="0.9" />
          ))}
          <circle cx={cx} cy={cy} r="98" fill="#EDF1EC" stroke="#17332B" strokeWidth="1.5" />
        </svg>
        <svg width="164" height="164" viewBox="0 0 100 100" style={{ position: "absolute", left: cx - 82, top: cy - 82 }}>
          {markPaths(2, "#17332B", "#C0266D")}
        </svg>
        <div style={{ position: "absolute", left: 84, top: 112, display: "flex", flexDirection: "column", width: 560 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <svg width="50" height="50" viewBox="0 0 100 100">
              {markPaths(1, "#17332B", "#C0266D")}
            </svg>
            <div style={{ fontFamily: "Archivo Expanded", fontSize: 38, fontWeight: 700, color: "#17332B", marginLeft: 14, letterSpacing: -0.8 }}>
              Segundo
            </div>
          </div>
          <div
            style={{ fontFamily: "Archivo Expanded", fontSize: 64, lineHeight: 1.04, color: "#17332B", fontWeight: 700, marginTop: 32, letterSpacing: -1.6 }}
          >
            Get paid every second you work.
          </div>
          <div style={{ fontSize: 27, color: "#4E6159", marginTop: 26, lineHeight: 1.35 }}>Pay that lands every second, on Monad.</div>
          <div style={{ fontFamily: "Archivo Semi", fontWeight: 600, fontSize: 21, letterSpacing: 1.7, color: "#C0266D", marginTop: 28 }}>
            № segundo.world
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}
