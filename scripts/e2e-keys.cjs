// "One passkey, many keys", end to end through the real UI with a Chrome virtual authenticator (PRF) standing in for
// the phone's fingerprint:
//   1. a client makes a passkey account and opens a tab with an invite link (the invite key comes from the passkey);
//   2. the browser forgets everything (localStorage cleared), the client signs back in with the same passkey and
//      rebuilds the invite link on the tab page: it must match the original exactly;
//   3. a freelancer in a separate browser context joins with the rebuilt link (Till.claim checks the invite key on chain);
//   4. the client seals private details, a verifier in a third context asks for them on the income statement, the
//      client shares two fields, and the verifier's page opens and checks the reply.
// Usage: node scripts/e2e-keys.cjs <baseUrl> [shotsDir]
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
  if (shots) await page.screenshot({ path: `${shots}/keys-${name}-${W}.png`, fullPage: true });
}
const pages = [];
function watch(page, who) {
  pages.push([who, page]);
  page.setDefaultNavigationTimeout(180000);
  page.on("pageerror", (e) => console.log(`PAGE ERROR (${who})`, e.message));
  page.on("console", (m) => m.type() === "error" && console.log(`CONSOLE (${who})`, m.text().slice(0, 300)));
}

(async () => {
  const browser = await chromium.launch();

  // ---------------------------------------------------------------- the client, with a passkey
  const client = await browser.newContext({ viewport: { width: W, height: 900 } });
  const page = await client.newPage();
  watch(page, "client");
  const cdp = await client.newCDPSession(page);
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
  await page.waitForFunction(() => /0x[0-9a-fA-F]{4}/.test(document.body.innerText), null, { timeout: 60000 });
  const address = await page.evaluate(() => JSON.parse(localStorage.getItem("segundo.passkey.v1")).address);
  step(`passkey account ${address}`);
  await page.getByText(/test AUSD/i).first().waitFor({ timeout: 90000 });

  await page.goto(`${base}/open`);
  await page.getByLabel(/Someone I.ll invite by link/).check();
  await page.getByLabel("Hourly rate").fill("30");
  await page.getByLabel("Budget").fill("1");
  await page.getByLabel(/What it/).fill("Invite from a passkey");
  await page.getByText(/invite key comes from your passkey/).first().waitFor({ timeout: 30000 });
  // Wait until the wallet balance covers the budget (the first drip of test AUSD).
  const ready = () => page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Open tab and pay/.test(b.textContent) && !b.disabled), null, { timeout: 60000 });
  try {
    await ready();
  } catch {
    // The automatic first drip didn't come: ask the faucet, as a person would.
    await page.getByRole("button", { name: /Get 25 test AUSD/ }).click();
    await ready();
  }
  await shot(page, "open");
  await page.getByRole("button", { name: /Open tab and pay/ }).click();
  await expectOk(page, /is open\./);
  const original = await page.getByLabel("Invite link").inputValue();
  const id = original.match(/\/join\/(\d+)#/)[1];
  step(`opened tab ${id}, invite link made from the passkey`);

  // ---------------------------------------------------------------- forget everything, rebuild
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${base}/app`);
  await page.getByRole("button", { name: /Sign back in with your passkey/i }).first().click();
  await page.waitForFunction((a) => JSON.parse(localStorage.getItem("segundo.passkey.v1") || "null")?.address === a, address, { timeout: 60000 });
  await page.goto(`${base}/tab/${id}`);
  await page.getByRole("button", { name: /Rebuild the invite link/ }).waitFor({ timeout: 60000 });
  step("localStorage cleared, signed back in: the tab offers to rebuild its link");
  await shot(page, "rebuild-offer");
  await page.getByRole("button", { name: /Rebuild the invite link/ }).click();
  await page.getByLabel("Invite link").waitFor({ timeout: 60000 });
  const rebuilt = await page.getByLabel("Invite link").inputValue();
  if (rebuilt !== original) throw new Error(`rebuilt link differs:\n  ${original}\n  ${rebuilt}`);
  step("rebuilt invite link matches the original exactly");
  await shot(page, "rebuilt");

  // ---------------------------------------------------------------- the freelancer claims with it
  const free = await browser.newContext({ viewport: { width: W, height: 900 } });
  const fp = await free.newPage();
  watch(fp, "freelancer");
  await fp.goto(rebuilt);
  await fp.getByRole("button", { name: /Use a practice wallet instead/ }).first().click();
  await fp.getByLabel("Your name").fill("Keys Test Freelancer");
  await fp.getByLabel("Your city").fill("Pune");
  await fp.getByRole("button", { name: /Join this tab/ }).click();
  await fp.waitForURL(new RegExp(`/tab/${id}$`), { timeout: 120000 });
  await fp.getByText(/Clock in/i).first().waitFor({ timeout: 60000 });
  step("freelancer joined with the rebuilt link (claim verified on chain)");
  await shot(fp, "claimed");

  // ---------------------------------------------------------------- seal details
  await page.goto(`${base}/app#sealed`);
  const add = page.getByRole("button", { name: /Add your details/ });
  await add.waitFor({ timeout: 30000 });
  await add.click();
  await page.getByLabel(/Legal name/i).fill("Mara Lindqvist");
  await page.getByLabel(/Tax ID/i).fill("SE-TEST-0001");
  await page.getByLabel(/^Address/i).fill("Storgatan 1, 111 51 Stockholm");
  await page.getByLabel(/Country/i).fill("Sweden");
  await page.getByRole("button", { name: /Seal with your passkey/i }).click();
  await page.getByText("Mara Lindqvist").first().waitFor({ timeout: 30000 });
  step("details sealed (version 2 envelope)");
  const version = await page.evaluate((a) => JSON.parse(localStorage.getItem(`segundo.sealed.v1.${a.toLowerCase()}`)).version, address);
  if (version !== 2) throw new Error(`expected a version 2 envelope, got ${version}`);

  // ---------------------------------------------------------------- a verifier asks
  const verifier = await browser.newContext({ viewport: { width: W, height: 900 } });
  const vp = await verifier.newPage();
  watch(vp, "verifier");
  await vp.goto(`${base}/proof/${address}?request=1`);
  await vp.getByLabel("Request link to send").waitFor({ timeout: 60000 });
  const request = await vp.getByLabel("Request link to send").inputValue();
  step(`verifier made a one-time request key: ${request.replace(/^.*#verifier=/, "#verifier=").slice(0, 24)}…`);
  await shot(vp, "verifier-request");

  // ---------------------------------------------------------------- the client shares two fields
  await page.goto(request);
  await page.getByLabel("Their request link or code").waitFor({ timeout: 60000 });
  const tax = page.getByRole("checkbox", { name: "Tax ID" });
  if (!(await tax.isChecked())) await tax.check();
  const addr = page.getByRole("checkbox", { name: "Address" });
  if (await addr.isChecked()) await addr.uncheck();
  await page.getByText(/^Total received$/).first().waitFor({ timeout: 120000 });
  await shot(page, "share-form");
  await page.getByRole("button", { name: /Seal for this verifier/ }).click();
  await page.getByLabel("Reply link to send").waitFor({ timeout: 60000 });
  const reply = await page.getByLabel("Reply link to send").inputValue();
  step(`reply sealed for the verifier only (${reply.length} characters)`);
  await shot(page, "share-done");

  // ---------------------------------------------------------------- a stranger can't open it
  const stranger = await browser.newContext({ viewport: { width: W, height: 900 } });
  const sp = await stranger.newPage();
  watch(sp, "stranger");
  await sp.goto(reply);
  await sp.locator(".notice.error").first().waitFor({ timeout: 60000 });
  step(`another browser can't open it: "${(await sp.locator(".notice.error").first().innerText()).slice(0, 70)}…"`);

  // ---------------------------------------------------------------- the verifier opens it
  await vp.goto(reply);
  await vp.getByRole("heading", { name: "Verified details for this statement" }).waitFor({ timeout: 60000 });
  const box = await vp.locator("section", { has: vp.getByRole("heading", { name: "Verified details for this statement" }) }).innerText();
  if (!/Mara Lindqvist/.test(box) || !/SE-TEST-0001/.test(box)) throw new Error(`verified box is missing details:\n${box}`);
  if (/Storgatan/.test(box)) throw new Error("the address was shared although it was unticked");
  step("verifier's page checked the signature, decrypted, and shows the two picked fields only");
  await shot(vp, "verified");

  // A changed reply must not open.
  const at = reply.length - 30;
  const tampered = reply.slice(0, at) + (reply[at] === "A" ? "B" : "A") + reply.slice(at + 1);
  await vp.goto(`${base}/proof/${address}?request=1`);
  await vp.getByLabel("Their reply").fill(tampered);
  await vp.getByRole("button", { name: /Open and check/ }).click();
  await vp.locator(".notice.error").first().waitFor({ timeout: 30000 });
  step("a reply changed by one character is refused");

  console.log("OK");
  await browser.close();
})().catch(async (e) => {
  console.error("FAILED", e.message);
  for (const [who, p] of pages) {
    try {
      if (shots) await p.screenshot({ path: `${shots}/keys-failed-${who}-${W}.png`, fullPage: true });
      const err = await p.locator(".notice.error").allInnerTexts();
      if (err.length) console.error(`  ${who} says: ${err.join(" | ")}`);
    } catch {}
  }
  process.exit(1);
});
