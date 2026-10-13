/**
 * Step 2: the load test itself. Three runs against the running tabs from setup.mjs, every transaction a real
 * Till.settle(id) that pays a freelancer what they earned since the last one:
 *
 *   A. many senders: every second, each of the 16 sender keys sends one settle for each of its own tabs,
 *      so all 96 tabs are paid every second, for WAVES seconds. Senders are spread over three public RPC
 *      endpoints because the Monad Foundation endpoint allows 50 calls a second per client.
 *   B. one sender, pipelined: a single fresh key fires PIPE settles at once with consecutive nonces.
 *   C. one sender, one at a time: send, wait for the receipt, send the next. This is how Segundo's relayer
 *      works today (web/lib/server.ts), run for SERIAL_S seconds.
 *
 *   node scripts/bench/burst.mjs [waves=5] [pipe=48] [serial=30]
 *
 * Raw per-transaction records go to scripts/bench/out/run-<time>.json; report.mjs turns them into bench.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { viem, accounts, pub, envKey, loadKeys, saveKeys, TILL, tillAbi, sign, sendRaw, rpc, rpcBatch, receipts, nonceOf, requireWeb, sleep, fmt } from "./lib.mjs";

const arg = (k, d) => Number((process.argv.find((a) => a.startsWith(k + "=")) || `=${d}`).split("=")[1]);
const WAVES = arg("waves", 5);
const PIPE = arg("pipe", 48);
const SERIAL_S = arg("serial", 30);
const ENDPOINTS = ["https://testnet-rpc.monad.xyz", "https://monad-testnet.drpc.org", "https://10143.rpc.thirdweb.com"];
const MAX_FEE = 110_000_000_000n; // base fee is 100 gwei on testnet; the in-flight budget per sender is counted at this price
const STEADY = 84_456n; // eth_estimateGas for settle() on a tab whose freelancer already holds AUSD (measured on live tabs)
const margin = (g, pct = 8n) => (g * (100n + pct)) / 100n;

const k = loadKeys();
const keeper = accounts.privateKeyToAccount(envKey("KEEPER_KEY"));
const acct = (x) => accounts.privateKeyToAccount(x.pk);
const settleData = (id) => viem.encodeFunctionData({ abi: tillAbi, functionName: "settle", args: [BigInt(id)] });

// A dedicated key for the one-sender runs, so they start from a clean nonce the way a relayer would.
if (!k.solo) {
  const pk = accounts.generatePrivateKey();
  k.solo = { pk, address: accounts.privateKeyToAccount(pk).address };
  saveKeys(k);
}
if ((await pub.getBalance({ address: k.solo.address })) === 0n) {
  const tx = await sign(keeper, { to: k.solo.address, value: viem.parseEther("1.0"), gas: 21_000n, nonce: await nonceOf(keeper.address) });
  await sendRaw([tx]);
  await receipts([tx.hash]);
  k.spent.soloFunded = viem.parseEther("1.0").toString();
  saveKeys(k);
  console.log("solo key funded with 1.0 MON");
}

// Every block header as it arrives over WebSocket, with the local time we first saw it.
const WebSocket = requireWeb("ws");
const seen = new Map();
const ws = new WebSocket("wss://testnet-rpc.monad.xyz");
await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newHeads"] }));
ws.on("message", (m) => {
  const j = JSON.parse(String(m));
  const h = j.params?.result;
  if (h?.number) { const n = Number(BigInt(h.number)); if (!seen.has(n)) seen.set(n, Date.now()); }
});
await sleep(1500);

const records = [];
const bySender = k.senders.map((s) => k.tabs.filter((t) => t.payer.toLowerCase() === s.address.toLowerCase()));

// ---------------------------------------------------------------- A: many senders
const fresh = await pub.estimateGas({ account: k.senders[0].address, to: TILL, data: settleData(bySender[0][0].id) });
console.log(`settle gas: first payout to a new freelancer estimated ${fresh}, later ${STEADY}`);
const nonces = await Promise.all(k.senders.map((s) => nonceOf(s.address)));
const t0 = Date.now() + 1500;
const waves = [];
for (let w = 0; w < WAVES; w++) {
  waves.push((async () => {
    const at = t0 + w * 1000;
    // Sign just before the wave, so each wave carries its own gas limit and nothing waits on signing.
    await sleep(Math.max(0, at - 300 - Date.now()));
    const gas = w === 0 ? margin(fresh, 6n) : margin(STEADY);
    const batches = await Promise.all(k.senders.map(async (s, i) => {
      const txs = [];
      for (let j = 0; j < bySender[i].length; j++)
        txs.push(await sign(acct(s), { to: TILL, data: settleData(bySender[i][j].id), gas, nonce: nonces[i] + w * bySender[i].length + j, maxFeePerGas: MAX_FEE }));
      return txs;
    }));
    await sleep(Math.max(0, at - Date.now()));
    await Promise.all(batches.map(async (txs, i) => {
      const url = ENDPOINTS[i % ENDPOINTS.length];
      const sent = await sendRaw(txs, url, 50);
      const ackAt = Date.now();
      sent.forEach((r, j) => records.push({ run: "multi", wave: w, sender: i, tab: bySender[i][j].id, gas: gas.toString(), endpoint: i % ENDPOINTS.length, ...r, ackAt }));
    }));
  })());
}
await Promise.all(waves);
const multi = records.filter((r) => r.run === "multi");
console.log(`A: sent ${multi.length} settles, ${multi.filter((r) => r.error).length} refused${multi.find((r) => r.error) ? ` (first: ${multi.find((r) => r.error).error})` : ""}`);
await receipts(multi.filter((r) => !r.error).map((r) => r.hash), 60_000);
await sleep(2000);

// ---------------------------------------------------------------- B: one sender, pipelined
{
  const n0 = await nonceOf(k.solo.address);
  const gas = margin(STEADY);
  const txs = [];
  for (let j = 0; j < PIPE; j++) txs.push(await sign(acct(k.solo), { to: TILL, data: settleData(k.tabs[j % k.tabs.length].id), gas, nonce: n0 + j, maxFeePerGas: MAX_FEE }));
  await sleep(1500);
  const sent = await sendRaw(txs, ENDPOINTS[0], 50);
  const ackAt = Date.now();
  sent.forEach((r, j) => records.push({ run: "pipe", sender: "solo", tab: k.tabs[j % k.tabs.length].id, gas: gas.toString(), endpoint: 0, ...r, ackAt }));
  console.log(`B: sent ${PIPE} settles from one key at once, ${sent.filter((r) => r.error).length} refused${sent.find((r) => r.error) ? ` (first: ${sent.find((r) => r.error).error})` : ""}`);
  await receipts(sent.filter((r) => !r.error).map((r) => r.hash), 60_000);
  await sleep(2000);
}

// ---------------------------------------------------------------- C: one sender, one at a time
{
  let n = await nonceOf(k.solo.address);
  const gas = margin(STEADY);
  const end = Date.now() + SERIAL_S * 1000;
  let i = 0;
  while (Date.now() < end) {
    const tab = k.tabs[(i * 7) % k.tabs.length].id; // stride through the tabs so each has had time to earn
    const tx = await sign(acct(k.solo), { to: TILL, data: settleData(tab), gas, nonce: n, maxFeePerGas: MAX_FEE });
    const sentAt = Date.now();
    let error = null;
    try { await rpc("eth_sendRawTransaction", [tx.raw]); } catch (e) { error = e.message; }
    let receiptAt = null;
    if (!error) {
      for (;;) {
        const r = await rpc("eth_getTransactionReceipt", [tx.hash]).catch(() => null);
        if (r) { receiptAt = Date.now(); break; }
        if (Date.now() - sentAt > 30_000) break;
        await sleep(150);
      }
      n++;
    }
    records.push({ run: "serial", sender: "solo", tab, gas: gas.toString(), endpoint: 0, hash: tx.hash, sentAt, error, receiptAt });
    i++;
  }
  console.log(`C: ${i} settles one after another in ${SERIAL_S} s`);
}

// ---------------------------------------------------------------- collect
await sleep(3000);
const hashes = records.filter((r) => !r.error).map((r) => r.hash);
const got = await receipts(hashes, 60_000);
ws.close();
for (const r of records) {
  const rc = got.get(r.hash);
  if (!rc) continue;
  r.block = Number(BigInt(rc.blockNumber));
  r.index = Number(BigInt(rc.transactionIndex));
  r.status = rc.status === "0x1" ? "success" : "reverted";
  r.gasUsed = Number(BigInt(rc.gasUsed));
  r.seenAt = seen.get(r.block) ?? null;
  r.paid = "0";
  for (const log of rc.logs) {
    try {
      const ev = viem.decodeEventLog({ abi: tillAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "Settled") r.paid = ev.args.amount.toString();
    } catch {}
  }
}
const touched = [...new Set(records.filter((r) => r.block).map((r) => r.block))];
const lo = Math.min(...touched), hi = Math.max(...touched);
const nums = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
const bl = await rpcBatch(nums.map((n) => ({ method: "eth_getBlockByNumber", params: ["0x" + n.toString(16), false] })));
const blocks = bl.map((b, i) => ({
  number: nums[i],
  timestamp: b?.result ? Number(BigInt(b.result.timestamp)) : null,
  txs: b?.result ? b.result.transactions.length : null,
  gasUsed: b?.result ? Number(BigInt(b.result.gasUsed)) : null,
  gasLimit: b?.result ? Number(BigInt(b.result.gasLimit)) : null,
  seenAt: seen.get(nums[i]) ?? null,
}));

// Block time: the average over the last 10,000 blocks, from their timestamps.
const head = await pub.getBlock();
const back = await pub.getBlock({ blockNumber: head.number - 10_000n });
const blockTime = { blocks: 10_000, from: Number(back.number), to: Number(head.number), avgMs: Math.round((Number(head.timestamp - back.timestamp) * 1000) / 10_000) };

const here = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.join(here, "out"), { recursive: true });
const file = path.join(here, "out", `run-${new Date(t0).toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(
  file,
  JSON.stringify({ runAt: new Date(t0).toISOString(), senders: k.senders.map((s) => s.address), solo: k.solo.address, tabs: k.tabs.map((t) => t.id), endpoints: ENDPOINTS, freshGas: fresh.toString(), steadyGas: STEADY.toString(), blockTime, records, blocks }, null, 1),
);
console.log(`wrote ${file}`);
console.log(`solo key now ${fmt(await pub.getBalance({ address: k.solo.address }))} MON`);
