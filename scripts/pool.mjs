/**
 * Segundo's relayer pool: extra relayer keys beside the keeper (web/lib/pool.ts), each with its own test MON.
 *
 *   node scripts/pool.mjs fund [n=6] [mon=4]   make n keys (kept in keys/pool.json, gitignored), top each up to `mon`
 *                                              MON from the keeper, and write RELAYER_KEYS into web/.env.local
 *   node scripts/pool.mjs status               every pool key's address and MON
 *   node scripts/pool.mjs sweep                send every pool key's MON back to the keeper
 *   node scripts/pool.mjs value | vercel env add RELAYER_KEYS production
 *                                              hands the keys to another program; refuses to write them to a terminal
 *
 * Keys are read and written in-process and never printed. Run from the repository root with web/node_modules installed.
 */
import fs from "node:fs";
import path from "node:path";
import { viem, accounts, pub, envKey, ROOT, sign, sendRaw, receipts, rpcBatch, nonceOf, sleep, fmt } from "./bench/lib.mjs";

const FILE = path.join(ROOT, "keys/pool.json");
const ENV = path.join(ROOT, "web/.env.local");
const TIP = 2_000_000_000n;

const [cmd = "status", ...rest] = process.argv.slice(2);
const arg = (i, d) => (rest[i] !== undefined ? rest[i] : d);
const load = () => (fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { keys: [] });
const save = (p) => {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(p, null, 2));
};
const keeper = accounts.privateKeyToAccount(envKey("KEEPER_KEY"));

async function balances(keys) {
  const res = await rpcBatch(keys.map((k) => ({ method: "eth_getBalance", params: [k.address, "latest"] })));
  return res.map((r) => BigInt(r.result ?? "0x0"));
}

/** Puts RELAYER_KEYS=<keys> into web/.env.local, replacing any earlier line, without echoing it. */
function writeEnv(keys) {
  const text = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/).filter((l) => !l.startsWith("RELAYER_KEYS="));
  while (lines.length && lines.at(-1) === "") lines.pop();
  lines.push(`RELAYER_KEYS=${keys.map((k) => k.pk).join(",")}`, "");
  fs.writeFileSync(ENV, lines.join(eol));
}

async function status(p) {
  const bal = await balances(p.keys);
  p.keys.forEach((k, i) => console.log(`  key ${i + 1}  ${k.address}  ${fmt(bal[i])} MON`));
  console.log(`  keeper (key 0) ${keeper.address}  ${fmt(await pub.getBalance({ address: keeper.address }))} MON`);
}

if (cmd === "fund") {
  const n = Number(arg(0, 6));
  const target = viem.parseEther(String(arg(1, 4)));
  const p = load();
  while (p.keys.length < n) {
    const pk = accounts.generatePrivateKey();
    p.keys.push({ pk, address: accounts.privateKeyToAccount(pk).address });
  }
  save(p);
  const keys = p.keys.slice(0, n);
  const bal = await balances(keys);
  const need = keys.map((k, i) => ({ k, value: bal[i] < target ? target - bal[i] : 0n })).filter((x) => x.value > 0n);
  const total = need.reduce((a, x) => a + x.value, 0n);
  const have = await pub.getBalance({ address: keeper.address });
  if (have < total + viem.parseEther("5")) throw new Error(`the keeper has ${fmt(have)} MON; topping up the pool needs ${fmt(total)} and the keeper keeps 5`);
  if (need.length) {
    let nonce = await nonceOf(keeper.address);
    const signed = [];
    for (const x of need) signed.push(await sign(keeper, { to: x.k.address, value: x.value, gas: 21_000n, nonce: nonce++ }));
    const sent = await sendRaw(signed);
    const refused = sent.filter((s) => s.error);
    const got = await receipts(sent.filter((s) => !s.error).map((s) => s.hash));
    console.log(`sent ${fmt(total)} MON from the keeper to ${need.length} pool keys: ${got.size} landed, ${refused.length} refused${refused[0] ? ` (${refused[0].error})` : ""}`);
    p.funded = (BigInt(p.funded ?? "0") + total).toString();
    save(p);
  } else console.log("every pool key already holds the target");
  writeEnv(keys);
  console.log(`RELAYER_KEYS (${keys.length} keys) written to web/.env.local`);
  await status({ keys });
} else if (cmd === "sweep") {
  const p = load();
  // An account can empty itself on Monad only when the sweep is its only transaction in its last few blocks.
  await sleep(4000);
  const block = await pub.getBlock();
  const price = block.baseFeePerGas + TIP;
  const fee = 21_000n * price;
  const bal = await balances(p.keys);
  const signed = [];
  let total = 0n;
  for (let i = 0; i < p.keys.length; i++) {
    if (bal[i] <= fee) continue;
    total += bal[i] - fee;
    const acct = accounts.privateKeyToAccount(p.keys[i].pk);
    signed.push(await sign(acct, { to: keeper.address, value: bal[i] - fee, gas: 21_000n, nonce: await nonceOf(acct.address), maxFeePerGas: price, maxPriorityFeePerGas: TIP }));
  }
  if (signed.length) {
    const sent = await sendRaw(signed);
    const refused = sent.filter((s) => s.error);
    const got = await receipts(sent.filter((s) => !s.error).map((s) => s.hash));
    console.log(`swept ${fmt(total)} MON from ${signed.length} pool keys to the keeper: ${got.size} landed, ${refused.length} refused${refused[0] ? ` (${refused[0].error})` : ""}`);
    p.returned = (BigInt(p.returned ?? "0") + total).toString();
    save(p);
  } else console.log("nothing to sweep");
  await status(p);
} else if (cmd === "value") {
  if (process.stdout.isTTY) {
    console.error("This writes private keys: pipe it into another program, e.g. `node scripts/pool.mjs value | vercel env add RELAYER_KEYS production`.");
    process.exit(1);
  }
  const p = load();
  if (!p.keys.length) throw new Error("no pool keys yet: run `node scripts/pool.mjs fund` first");
  process.stdout.write(p.keys.map((k) => k.pk).join(","));
} else {
  const p = load();
  if (!p.keys.length) console.log("no pool keys yet: run `node scripts/pool.mjs fund`");
  else await status(p);
}
