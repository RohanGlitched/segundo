// End to end with a Mera passkey account, through the real UI: a Chrome virtual authenticator with PRF stands in
// for the phone's fingerprint. Creates the account, waits for test AUSD, opens a tab to a demo freelancer with the
// 1% fee, watches a payout land, then seals private details.
// Usage: node scripts/e2e-mera.cjs <baseUrl> [shotsDir]
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const base = process.argv[2] || "http://localhost:3310";
const shots = process.argv[3];
const W = Number(process.env.WIDTH || 1280);

const step = (s) => console.log(`- ${s}`);
async function expectOk(page, re, timeout = 90000) {
  const ok = page.getByText(re).first();
  const err = page.locator(".notice.error").first();
  await Promise.race([
    ok.waitFor({ timeout }),
    err.waitFor({ timeout }).then(async () => {
      throw new Error(`app said: ${await err.innerText()}`);
    }),
  ]);
}
async function shot(page, name) {
  if (shots) await page.screenshot({ path: `${shots}/mera-${name}-${W}.png`, fullPage: true });
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: 900 } });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(180000);
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

  await page.goto(`${base}/app`);
  await page.getByRole("button", { name: /Create your account with a passkey/i }).first().click();
  step("passkey created");
  await page.waitForFunction(() => /0x[0-9a-fA-F]{4}/.test(document.body.innerText), null, { timeout: 60000 });
  await page.getByText(/test AUSD/i).first().waitFor({ timeout: 90000 });
  step("signed in with Mera");
  await shot(page, "app");

  await page.goto(`${base}/open`);
  await page.getByRole("button", { name: /Tunde Bakare/ }).click();
  await page.getByLabel("Hourly rate").fill("60");
  await page.getByLabel("Budget").fill("2");
  await page.getByLabel(/What it/).fill("API review, passkey run");
  await page.getByText(/Segundo fee/).first().waitFor({ timeout: 30000 });
  await shot(page, "open");
  await page.getByRole("button", { name: /Open tab/ }).click();
  await expectOk(page, /is open\./);
  step(`opened: ${await page.getByRole("heading", { level: 1 }).innerText()}`);
  const feeLine = await page.getByText(/fee/i).allInnerTexts();
  step(`fee lines: ${feeLine.filter((t) => /\$|block/i.test(t)).slice(0, 3).join(" | ")}`);
  await shot(page, "opened");
  await page.getByRole("link", { name: "Go to the tab" }).click();
  await page.getByText("On the clock", { exact: false }).first().waitFor({ timeout: 90000 });
  step("freelancer clocked in");
  await page.getByText(/Paid out|payout/i).first().waitFor({ timeout: 90000 });
  step("payout seen");
  await shot(page, "tab");

  await page.goto(`${base}/app#sealed`);
  const edit = page.getByRole("button", { name: /Add|Edit|Seal/i }).filter({ hasText: /detail|seal|add/i }).first();
  await edit.click();
  await page.getByLabel(/Legal name/i).fill("Mara Lindqvist");
  await page.getByLabel(/Tax ID/i).fill("SE-TEST-0001");
  await page.getByRole("button", { name: /Seal/i }).last().click();
  await page.getByText("Mara Lindqvist").first().waitFor({ timeout: 30000 });
  step("details sealed");
  await shot(page, "sealed");

  console.log("OK");
  await browser.close();
})().catch((e) => {
  console.error("FAILED", e.message);
  process.exit(1);
});
