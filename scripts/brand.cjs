// Segundo brand assets: PWA and touch icons, the README cover and logo, and the 1080 px logo for the
// hackathon platform. The mark comes from web/components/Mark.tsx and the engraving from
// web/lib/guilloche.ts (transpiled with the app's own TypeScript), so the PNGs never drift from the site.
// Usage: PLAYWRIGHT=<path to the playwright package> node scripts/brand.cjs   (fonts load from Google Fonts)
const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "web");
const ts = require(path.join(WEB, "node_modules", "typescript"));

const loaded = new Map();
function load(file) {
  if (loaded.has(file)) return loaded.get(file);
  const src = fs.readFileSync(file, "utf8");
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const mod = { exports: {} };
  loaded.set(file, mod.exports);
  const req = (id) => {
    if (id.startsWith("@/")) {
      const base = path.join(WEB, id.slice(2));
      return load([".ts", ".tsx"].map((x) => base + x).find((f) => fs.existsSync(f)));
    }
    return require(require.resolve(id, { paths: [WEB] }));
  };
  new Function("exports", "require", "module", outputText)(mod.exports, req, mod);
  loaded.set(file, mod.exports);
  return mod.exports;
}
const { markParts } = load(path.join(WEB, "components", "Mark.tsx"));
const { bandPaths, bandsFor, ringPath, ringsFor, seedOf, wavePath } = load(path.join(WEB, "lib", "guilloche.ts"));

const C = { paper: "#EDF1EC", sheet: "#F7F9F6", ink: "#17332B", soft: "#4E6159", rule: "#CFD8D1", serial: "#C0266D", blue: "#2557B0" };

/** The mark as an SVG string at `px`, optionally on a paper disc. */
function markSvg(level, px, { disc = false, ink = C.ink, serial = C.serial } = {}) {
  const paths = markParts(level)
    .map((p) => {
      const col = p.tone === "ink" ? ink : serial;
      return p.fill
        ? `<path d="${p.d}" fill="${col}"/>`
        : `<path d="${p.d}" fill="none" stroke="${col}" stroke-width="${p.w}"${p.round ? ' stroke-linecap="round"' : ""}/>`;
    })
    .join("");
  return `<svg width="${px}" height="${px}" viewBox="0 0 100 100" style="display:block">${disc ? `<circle cx="50" cy="50" r="50" fill="${C.paper}"/>` : ""}${paths}</svg>`;
}

/** The note's big rosette (woven bands, the outer one in serial red) with the dial in its medallion. */
function rosetteSvg(cx, cy, size, medallion) {
  const seed = seedOf("segundo", "1");
  const bands = bandsFor(seed, 7).flatMap((b) => bandPaths(cx, cy, size, b));
  const core = ringsFor(seed, 2).map((r, i) => ringPath(cx, cy, size * (i ? 0.33 : 0.29), { ...r, scale: 1 }));
  return [
    ...bands.map((d, i) => `<path d="${d}" fill="none" stroke="${i < bands.length - 8 ? C.blue : C.serial}" stroke-width="0.8" opacity="0.8"/>`),
    ...core.map((d) => `<path d="${d}" fill="none" stroke="${C.blue}" stroke-width="0.9"/>`),
    `<circle cx="${cx}" cy="${cy}" r="${medallion}" fill="${C.paper}" stroke="${C.ink}" stroke-width="1.5"/>`,
  ].join("");
}

const FONT = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=block">`;
const BASE = `*{box-sizing:border-box}html,body{margin:0}body{font-family:Archivo,sans-serif;color:${C.ink};-webkit-font-smoothing:antialiased}`;
const WORD = `font-variation-settings:"wdth" 125;font-weight:750;letter-spacing:-0.02em`;

/** The banknote card: README cover (1280 × 640). The OG route draws the same card at 1200 × 630. */
function card(W, H) {
  const waves = [0, 1, 2].flatMap((i) => [wavePath(30, 28, W - 60, 7, 34, i * 2.1), wavePath(30, H - 28, W - 60, 7, 34, i * 2.1 + 1)]);
  const rx = W - 330;
  const ry = H / 2;
  return `<!doctype html><html><head>${FONT}<style>${BASE}
  body{width:${W}px;height:${H}px;background:${C.paper};position:relative;overflow:hidden}
  svg.bg{position:absolute;inset:0}
  .copy{position:absolute;left:92px;top:118px;width:${rx - 350}px}
  .lock{display:flex;align-items:center;gap:14px}
  .word{${WORD};font-size:40px}
  h1{margin:34px 0 0;${WORD};font-weight:700;font-size:70px;line-height:1.02;letter-spacing:-0.025em}
  p{margin:26px 0 0;font-size:27px;line-height:1.35;color:${C.soft}}
  .serial{margin-top:30px;font-variation-settings:"wdth" 87;font-weight:600;font-size:21px;letter-spacing:0.08em;color:${C.serial}}
  .dial{position:absolute;left:${rx - 84}px;top:${ry - 84}px}
  </style></head><body>
  <svg class="bg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${waves.map((d) => `<path d="${d}" fill="none" stroke="${C.blue}" stroke-width="1.2" opacity="0.7"/>`).join("")}
    ${rosetteSvg(rx, ry, 255, 100)}
  </svg>
  <div class="dial">${markSvg(2, 168)}</div>
  <div class="copy">
    <div class="lock">${markSvg(1, 52)}<span class="word">Segundo</span></div>
    <h1>Get paid every second you work.</h1>
    <p>Pay that lands every second, on Monad.</p>
    <div class="serial">№ segundo.world</div>
  </div>
  </body></html>`;
}

function square(px, inner, bg = C.paper) {
  return `<!doctype html><html><head>${FONT}<style>${BASE}
  body{width:${px}px;height:${px}px;background:${bg};display:flex;flex-direction:column;align-items:center;justify-content:center}
  .word{${WORD}}</style></head><body>${inner}</body></html>`;
}

const out = (...p) => path.join(ROOT, ...p);
const JOBS = [
  // Web app icons. "any" icons are a paper disc on transparent; maskable and Apple are full bleed.
  { file: out("web", "public", "icons", "icon-192.png"), px: 192, html: square(192, markSvg(2, 192, { disc: true }), "transparent"), alpha: true },
  { file: out("web", "public", "icons", "icon-512.png"), px: 512, html: square(512, markSvg(2, 512, { disc: true }), "transparent"), alpha: true },
  // Maskable: the mark sits inside the central 80 % safe circle (radius 204.8 of 512).
  { file: out("web", "public", "icons", "maskable-512.png"), px: 512, html: square(512, markSvg(2, 350)) },
  { file: out("web", "public", "icons", "apple-touch-icon.png"), px: 180, html: square(180, markSvg(2, 140)) },
  // README.
  { file: out("docs", "logo.png"), px: 512, html: square(512, markSvg(2, 420)) },
  { file: out("docs", "cover.png"), w: 1280, h: 640, html: card(1280, 640) },
  // Hackathon platform logo (min 500 px): the dial with the wordmark under it.
  {
    file: path.join(ROOT, "..", "video", "segundo-logo.png"),
    px: 1080,
    html: square(1080, `${markSvg(2, 690)}<div class="word" style="font-size:118px;margin-top:44px">Segundo</div>`),
  },
];

(async () => {
  const browser = await chromium.launch();
  for (const job of JOBS) {
    const w = job.w || job.px;
    const h = job.h || job.px;
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.setContent(job.html, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    fs.mkdirSync(path.dirname(job.file), { recursive: true });
    await page.screenshot({ path: job.file, omitBackground: !!job.alpha, clip: { x: 0, y: 0, width: w, height: h } });
    await page.close();
    console.log(path.relative(path.join(ROOT, ".."), job.file), `${w}x${h}`);
  }
  await browser.close();
})();
