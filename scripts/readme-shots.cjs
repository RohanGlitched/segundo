// Screenshots for the README, taken from the live site. Usage: node scripts/readme-shots.cjs [baseUrl]
const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const BASE = process.argv[2] || "https://segundo.world";
const OUT = path.join(__dirname, "..", "docs", "screens");
fs.mkdirSync(OUT, { recursive: true });
const keys = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "keys", "wallets.json"), "utf8"));

async function shotAt(page, name, selector, offset = 0) {
  if (selector) {
    await page.evaluate(
      ([s, o]) => {
        const el = document.querySelector(s);
        if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - o });
      },
      [selector, offset],
    );
    await page.waitForTimeout(1800);
  }
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(name);
}

(async () => {
  const b = await chromium.launch();

  // Desktop, light: the home page sections.
  const d = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await d.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await d.locator("figure").first().waitFor();
  await d.waitForTimeout(9000);
  await shotAt(d, "home-hero");
  await shotAt(d, "home-world", "#world", 90);
  await shotAt(d, "home-note", "#note", 90);
  await shotAt(d, "home-arrive", "#arrive", 90);
  await shotAt(d, "home-ink", "#ink", 90);
  await d.waitForTimeout(4000);
  await shotAt(d, "home-monad", "#monad", 90);

  // A live tab, watched by anyone.
  const live = await d.evaluate(() => fetch("/api/live").then((r) => r.json()));
  const id = live.featured?.id ?? 1;
  await d.goto(`${BASE}/tab/${id}`, { waitUntil: "domcontentloaded" });
  await d.waitForTimeout(14000);
  await shotAt(d, "tab-live");
  await shotAt(d, "tab-timecard", "#timecard", 90);

  // A seeded freelancer's own view (her key stays in this headless browser).
  await d.goto(BASE + "/app");
  await d.evaluate((k) => localStorage.setItem("till.practice.v1", k), keys.bot4.privateKey);
  await d.goto(BASE + "/app", { waitUntil: "domcontentloaded" });
  await d.waitForTimeout(9000);
  await shotAt(d, "app-freelancer");
  await d.evaluate(() => localStorage.clear());

  // Sign-in with passkeys, and opening a tab (fresh practice wallet).
  const n = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await n.goto(BASE + "/app", { waitUntil: "domcontentloaded" });
  await n.waitForTimeout(4000);
  await shotAt(n, "signin");
  await n.getByRole("button", { name: /practice wallet/i }).click();
  await n.goto(BASE + "/open", { waitUntil: "domcontentloaded" });
  await n.waitForTimeout(3500);
  await n.getByRole("button", { name: /Priya Nair/ }).click();
  await n.getByLabel("Hourly rate").fill("40");
  await n.getByLabel("Budget").fill("12");
  await n.getByLabel(/What it/).fill("Illustrations for the launch");
  await n.waitForTimeout(1500);
  await shotAt(n, "open");

  // Dark mode hero.
  const dk = await b.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await dk.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await dk.waitForTimeout(9000);
  await shotAt(dk, "home-dark");

  // Phone.
  const ph = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ph.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await ph.waitForTimeout(9000);
  await shotAt(ph, "phone-home");
  await ph.goto(`${BASE}/tab/${id}`, { waitUntil: "domcontentloaded" });
  await ph.waitForTimeout(12000);
  await shotAt(ph, "phone-tab");
  await ph.goto(BASE + "/#ink", { waitUntil: "domcontentloaded" });
  await ph.waitForTimeout(6000);
  await shotAt(ph, "phone-ink", "#ink", 70);

  await b.close();
})();
