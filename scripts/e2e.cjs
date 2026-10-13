// End to end through the real UI with a practice wallet: faucet, profile, open a tab to a demo
// freelancer, watch it pay out, pause, close (with its confirm step) and get the rest back. Then the
// invite flow with a second browser as the freelancer.
// Usage: node scripts/e2e.cjs <baseUrl> [shotsDir]
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const base = process.argv[2] || "http://localhost:3310";
const shots = process.argv[3];
const W = Number(process.env.WIDTH || 1280);

const step = (s) => console.log(`- ${s}`);
/** Waits for the success text, or reports the app's own error message if one appears first. */
async function expectOk(page, re, timeout = 60000) {
  const ok = page.getByText(re).first();
  const err = page.locator(".notice.error").first();
  await Promise.race([ok.waitFor({ timeout }), err.waitFor({ timeout }).then(async () => {
    throw new Error(`app said: ${await err.innerText()}`);
  })]);
}
async function shot(page, name) {
  if (shots) await page.screenshot({ path: `${shots}/e2e-${name}-${W}.png`, fullPage: true });
}

(async () => {
  const browser = await browser_();
  async function browser_() {
    return chromium.launch();
  }
  const client = await browser.newContext({ viewport: { width: W, height: 900 } });
  const page = await client.newPage();
  // A dev server compiles each page on its first visit, which can take longer than Playwright's 30 s default.
  client.setDefaultNavigationTimeout(180000);
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  page.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text()));

  await page.goto(`${base}/app`);
  await page.getByRole("button", { name: /practice wallet/i }).click();
  step("practice wallet created");
  // A new wallet gets its first 25 test AUSD by itself; the button only matters if that drip didn't go.
  await page.getByText(/25 test AUSD arrived/).waitFor({ timeout: 60000 }).catch(async () => {
    await page.getByRole("button", { name: "Get 25 test AUSD" }).first().click();
    await page.getByText(/25 test AUSD arrived/).waitFor({ timeout: 60000 });
  });
  step("faucet: 25 test AUSD arrived");

  await page.getByLabel("Name", { exact: true }).fill("Mara Lindqvist");
  await page.getByLabel("City", { exact: true }).fill("Stockholm");
  await page.getByLabel("Show amounts in").selectOption("EUR");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByText(/Your notes print/).waitFor({ timeout: 60000 });
  step("profile saved on chain");
  await shot(page, "app");

  await page.goto(`${base}/open`);
  await page.getByRole("button", { name: /Tunde Bakare/ }).click();
  await page.getByLabel("Hourly rate", { exact: true }).fill("60");
  await page.getByLabel("Budget", { exact: true }).fill("2");
  await page.getByLabel(/What it/).fill("API review, first session");
  await shot(page, "open");
  await page.getByRole("button", { name: /Open tab and pay \$/ }).click();
  await expectOk(page, /is open\./);
  const title = await page.getByRole("heading", { level: 1 }).innerText();
  step(`opened: ${title}`);
  await page.getByRole("link", { name: "Go to the tab" }).click();

  await page.getByText("On the clock", { exact: false }).first().waitFor({ timeout: 60000 });
  step("demo freelancer clocked in by themselves");
  await page.getByText(/landed in/).first().waitFor({ timeout: 60000 });
  step(`payout while watching: ${await page.getByText(/landed in/).first().innerText()}`);
  await shot(page, "tab-live");

  await page.getByRole("button", { name: "Pause pay" }).click();
  await page.getByText("Pay paused by the client").first().waitFor({ timeout: 60000 });
  step("client paused pay");
  await page.getByRole("button", { name: /Close and get/ }).click();
  await page.getByRole("button", { name: "Yes, close the tab" }).click();
  await page.getByText(/Tab closed\. Landed/).waitFor({ timeout: 60000 });
  step("closed and refunded");
  await page.getByText(/Tab closed, \$/).first().waitFor({ timeout: 30000 });
  step("pay stub shows the refund");
  await shot(page, "tab-closed");

  // Invite flow: the client opens a tab by link; a second browser joins as the freelancer.
  await page.goto(`${base}/open`);
  await page.getByText("Someone I'll invite by link").click();
  await page.getByLabel("Hourly rate", { exact: true }).fill("25");
  await page.getByLabel("Budget", { exact: true }).fill("1");
  await page.getByRole("button", { name: /Open tab and pay \$/ }).click();
  const linkBox = page.getByLabel("Invite link");
  await linkBox.waitFor({ timeout: 60000 });
  const link = await linkBox.inputValue();
  step(`invite link made: ${link.replace(/#k=.*/, "#k=…")}`);

  const free = await browser.newContext({ viewport: { width: 390, height: 844 } });
  free.setDefaultNavigationTimeout(180000);
  const fp = await free.newPage();
  fp.on("pageerror", (e) => console.log("FREELANCER PAGE ERROR", e.message));
  await fp.goto(link);
  await fp.getByRole("button", { name: /practice wallet/i }).click();
  await fp.getByLabel("Your name").fill("Ines Okafor");
  await fp.getByLabel("Your city").fill("Accra");
  await fp.getByRole("button", { name: "Join this tab" }).click();
  await fp.waitForURL(/\/tab\/\d+/, { timeout: 90000 });
  step("freelancer joined from the invite");
  await fp.getByRole("button", { name: "Clock in" }).click();
  await fp.getByText(/Clocked in\. Landed/).waitFor({ timeout: 60000 });
  step("freelancer clocked in");
  await fp.getByText(/landed in/).first().waitFor({ timeout: 60000 });
  step("freelancer sees payouts land");
  if (shots) await fp.screenshot({ path: `${shots}/e2e-freelancer-390.png`, fullPage: true });
  await fp.getByRole("button", { name: "Clock out" }).click();
  await fp.getByText(/Clocked out\. Landed/).waitFor({ timeout: 60000 });
  step("freelancer clocked out");

  // Hand the test USDC back to the faucet so the run doesn't drain it.
  if (process.env.RETURN_TO) {
    for (const [p, label] of [[fp, "freelancer"], [page, "client"]]) {
      await p.goto(`${base}/app`);
      await p.waitForTimeout(4000);
      const raw = await p.locator("[data-balance]").first().getAttribute("data-balance").catch(() => "0");
      const amount = Number(raw || 0) / 1e6;
      if (amount < 0.01) continue;
      await p.getByRole("button", { name: "Send AUSD" }).first().click();
      // The send sheet opens on "By link"; a faucet return goes to a plain address.
      await p.getByRole("button", { name: "To a wallet address" }).click();
      await p.locator("#send").getByLabel("Send to").fill(process.env.RETURN_TO);
      await p.locator("#send").getByLabel(/^Amount in/).fill(String(Math.floor(amount * 100) / 100));
      await p.locator("#send").getByRole("button", { name: "Send AUSD", exact: true }).click();
      await expectOk(p, /Sent \$/);
      step(`${label} returned $${Math.floor(amount * 100) / 100} to the faucet`);
    }
  }

  await browser.close();
  console.log("E2E PASSED");
})().catch((e) => {
  console.error("E2E FAILED:", e.message);
  process.exit(1);
});
