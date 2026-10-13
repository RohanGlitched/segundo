// End to end for send by link, through the real UI, with two Mera passkey accounts (Chrome virtual authenticators
// with PRF stand in for two phones). A makes an account, gets test AUSD, sends $1 by link and $0.50 by a second link.
// B opens the first link in a separate browser at phone width, creates an account with a passkey, and collects it:
// B's balance must be exactly $1.00. A then takes the second link back, and both used links say so plainly.
// Usage: node scripts/e2e-sendlink.cjs <baseUrl> [shotsDir]
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const base = process.argv[2] || "http://localhost:3310";
const shots = process.argv[3];

const step = (s) => console.log(`- ${s}`);
const open = [];
async function expectOk(page, re, timeout = 150000) {
  const ok = page.getByText(re).first();
  const err = page.locator(".notice.error").first();
  await Promise.race([
    ok.waitFor({ timeout }),
    err.waitFor({ timeout }).then(async () => {
      throw new Error(`app said: ${await err.innerText()}`);
    }),
  ]);
}
async function shot(page, name, full = true) {
  if (shots) await page.screenshot({ path: `${shots}/sendlink-${name}.png`, fullPage: full });
}
async function passkeyBrowser(browser, viewport, mobile) {
  const context = await browser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await context.newPage();
  open.push(page);
  page.setDefaultNavigationTimeout(180000);
  page.setDefaultTimeout(150000);
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  page.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text().slice(0, 300)));
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    },
  });
  return { context, page };
}
const balanceOf = (page) => page.evaluate(() => document.querySelector("[data-balance]")?.getAttribute("data-balance") || "");

// Links this browser has sent and seen land, read from where the app keeps them (the dev server may reload the page
// mid-send when files change; the link survives that, and so does this test).
const sentLinks = (page) =>
  page.evaluate(() => {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("segundo.links.v1.")) out.push(...JSON.parse(localStorage.getItem(k) || "[]").filter((l) => l.state === "sent"));
    }
    return out.sort((a, b) => b.at - a.at);
  });

async function makeLink(page, dollars, name) {
  const sheet = page.locator("dialog[open]");
  await sheet.getByLabel("Amount in US dollars").fill(dollars);
  await sheet.getByLabel("They spend").selectOption("PHP");
  await sheet.getByLabel("Your name on the link").fill(name);
  await sheet.getByText(/₱\d/).first().waitFor({ timeout: 30000 });
  const before = (await sentLinks(page)).length;
  await sheet.getByRole("button", { name: /^Create a \$/ }).click();
  await page.waitForFunction(
    (b) => {
      if (document.querySelector(".notice.error")) return true;
      let n = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("segundo.links.v1.")) n += JSON.parse(localStorage.getItem(k) || "[]").filter((l) => l.state === "sent").length;
      }
      return n > b;
    },
    before,
    { timeout: 240000 },
  );
  const err = page.locator(".notice.error").first();
  if (await err.isVisible().catch(() => false)) throw new Error(`app said: ${await err.innerText()}`);
  let link;
  if (await sheet.isVisible().catch(() => false)) {
    await expectOk(page, /is waiting in this link/, 30000);
    link = await sheet.locator('input[readonly][value*="/claim#k="]').inputValue();
  } else {
    // The page reloaded while the transfer was on its way: the link is in "Sent by link"; open it from there.
    step("(page reloaded during the send; reading the link from Sent by link)");
    const l = (await sentLinks(page))[0];
    link = `${base}/claim#k=${l.key.slice(2)}&a=${(Number(l.value) / 1e6).toFixed(2)}&c=${l.cur}${l.from ? `&f=${encodeURIComponent(l.from).replace(/%20/g, "+")}` : ""}`;
    await page.getByRole("button", { name: "Send AUSD" }).first().click();
  }
  if (!/\/claim#k=[0-9a-f]{64}&a=/.test(link)) throw new Error(`odd link: ${link}`);
  return link;
}

(async () => {
  const browser = await chromium.launch();

  // A: the sender, on a laptop.
  const A = await passkeyBrowser(browser, { width: 1280, height: 900 });
  await A.page.goto(`${base}/app`);
  await A.page.getByRole("button", { name: /Create your account with a passkey/i }).first().click();
  const funded = () =>
    A.page.waitForFunction(() => BigInt(document.querySelector("[data-balance]")?.getAttribute("data-balance") || "0") >= 2000000n, null, {
      timeout: 150000,
    });
  // A new wallet gets 25 test AUSD on its own; if that drip didn't go, ask for it the way a person would.
  await funded().catch(async () => {
    await A.page.getByRole("button", { name: "Get 25 test AUSD" }).first().click();
    await expectOk(A.page, /25 test AUSD arrived/);
    await funded();
  });
  step(`A signed in with a passkey and has ${Number(await balanceOf(A.page)) / 1e6} test AUSD`);

  await A.page.getByRole("button", { name: "Send AUSD" }).first().click();
  const sheet = A.page.locator("dialog[open]");
  await sheet.getByRole("button", { name: "By link" }).click();
  await sheet.getByLabel("Amount in US dollars").fill("1");
  await sheet.getByLabel("They spend").selectOption("PHP");
  await sheet.getByText(/₱\d/).first().waitFor({ timeout: 30000 });
  await shot(A.page, "a-sheet", false);
  const t0 = Date.now();
  const link1 = await makeLink(A.page, "1", "Ana Reyes");
  step(`link 1 ready in ${((Date.now() - t0) / 1000).toFixed(1)} s (key stays after #)`);
  await shot(A.page, "a-link-ready", false);
  const another = sheet.getByRole("button", { name: "Send another" });
  if (await another.isVisible().catch(() => false)) await another.click();
  const link2 = await makeLink(A.page, "0.50", "Ana Reyes");
  step("link 2 ready ($0.50, to take back)");
  await A.page.keyboard.press("Escape");
  await A.page.getByRole("heading", { name: "Sent by link" }).waitFor();
  await A.page.getByText("Waiting to be collected").nth(1).waitFor({ timeout: 30000 });
  await shot(A.page, "a-sent-list");

  // B: the receiver, on a phone, with its own passkey and nothing else.
  const B = await passkeyBrowser(browser, { width: 375, height: 812 }, true);
  await B.page.goto(link1);
  await B.page.getByRole("heading", { name: /Ana Reyes sent you/ }).waitFor({ timeout: 120000 });
  await B.page.getByRole("button", { name: /Create your account with a passkey/i }).first().waitFor();
  const h1 = await B.page.getByRole("heading", { level: 1 }).innerText();
  step(`B sees: "${h1}"`);
  await shot(B.page, "b-claim");
  const t1 = Date.now();
  await B.page.getByRole("button", { name: /Create your account with a passkey/i }).first().click();
  await expectOk(B.page, /is in your account/, 120000);
  const arrived = await B.page.getByText(/Arrived in/).first().innerText();
  step(`B made an account and collected: ${arrived} (${((Date.now() - t1) / 1000).toFixed(1)} s from the tap, passkey included)`);
  await B.page.waitForFunction(() => /\$1\.00 in AUSD/.test(document.querySelector('[data-testid="claim-balance"]')?.textContent || ""), null, {
    timeout: 30000,
  });
  step(`B's balance on the claim page: ${await B.page.locator('[data-testid="claim-balance"]').innerText()}`);
  await shot(B.page, "b-collected");

  await B.page.goto(`${base}/app`);
  await B.page.waitForFunction(() => document.querySelector("[data-balance]")?.getAttribute("data-balance") === "1000000", null, { timeout: 60000 });
  step("B's wallet on /app holds exactly 1.000000 AUSD");
  await B.page.locator("nav[aria-label='Main actions']").waitFor({ state: "visible" });
  step("bottom bar shows in a phone-width browser");
  await shot(B.page, "b-app");

  await B.page.goto(link1);
  await B.page.getByRole("heading", { name: /already been collected/ }).waitFor({ timeout: 60000 });
  step("link 1 opened again: says it has already been collected");
  await shot(B.page, "b-link-used");

  // A takes link 2 back.
  await A.page.bringToFront();
  const before = BigInt(await balanceOf(A.page));
  await A.page.getByRole("button", { name: "Take it back" }).first().click();
  await expectOk(A.page, /Back in your wallet\. Landed in/);
  step(`A took link 2 back: ${await A.page.getByText(/Back in your wallet\. Landed in/).first().innerText()}`);
  await A.page.waitForFunction((b) => BigInt(document.querySelector("[data-balance]")?.getAttribute("data-balance") || "0") === BigInt(b) + 500000n, before.toString(), {
    timeout: 30000,
  });
  step("A's balance went up by exactly $0.50");
  await A.page.getByText("Taken back").first().waitFor();
  await A.page.getByText("Collected", { exact: true }).first().waitFor();
  await shot(A.page, "a-taken-back");

  await B.page.goto(link2);
  await B.page.getByRole("heading", { name: /already been collected/ }).waitFor({ timeout: 60000 });
  step("link 2 opened after take-back: says so");

  // A's wallet at phone width: bottom bar and the sheet as a bottom sheet.
  await A.page.setViewportSize({ width: 375, height: 812 });
  await A.page.reload();
  await A.page.locator("nav[aria-label='Main actions']").getByRole("button", { name: "Send AUSD" }).click();
  await A.page.locator("dialog[open]").waitFor();
  await A.page.locator("dialog[open]").getByLabel("Amount in US dollars").fill("5");
  await A.page.locator("dialog[open]").getByText(/₱\d/).first().waitFor({ timeout: 30000 });
  await shot(A.page, "a-sheet-375", false);
  const overflow = await A.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error("page scrolls sideways at 375 px");
  step("send sheet at 375 px, no sideways scroll");

  console.log("OK");
  await browser.close();
})().catch(async (e) => {
  console.error("FAILED", e.message);
  for (const [i, p] of open.entries()) await shot(p, `failed-${i}`).catch(() => {});
  process.exit(1);
});
