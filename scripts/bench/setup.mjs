/**
 * Step 1 of the load benchmark: make fresh keys, fund them, open the tabs and clock everyone in.
 *
 *   node scripts/bench/setup.mjs [senders=16] [tabs=6]
 *
 * Each stage records what it did in keys/bench.json (gitignored), so a rerun resumes where it stopped.
 * Gas limits come from eth_estimateGas plus a small margin, because Monad bills the limit, not the use.
 */
import { viem, accounts, pub, envKey, loadKeys, saveKeys, KEYS_FILE, TILL, AUSD, tillAbi, erc20Abi, sign, sendRaw, receipts, nonceOf, rpcBatch, fmt } from "./lib.mjs";
import fs from "node:fs";

const arg = (k, d) => Number((process.argv.find((a) => a.startsWith(k + "=")) || `=${d}`).split("=")[1]);
const SENDERS = arg("senders", 16);
const TABS = arg("tabs", 6); // per sender
const RATE = 360_000n; // 0.36 AUSD an hour: 100 base units (0.0001 AUSD) a second, so every one-second settle moves money
const BUDGET = 500_000n; // 0.5 AUSD per tab, about 83 minutes at that rate
const MEMO = "Segundo load test";
const SENDER_MON = viem.parseEther(process.env.SENDER_MON || "0.9");
const PAYEE_MON = viem.parseEther(process.env.PAYEE_MON || "0.03");
const margin = (g, pct = 8n) => (g * (100n + pct)) / 100n;

const keeper = accounts.privateKeyToAccount(envKey("KEEPER_KEY"));
const faucet = accounts.privateKeyToAccount(envKey("FAUCET_KEY"));

let k = fs.existsSync(KEYS_FILE) ? loadKeys() : null;
if (!k) {
  const make = () => { const pk = accounts.generatePrivateKey(); return { pk, address: accounts.privateKeyToAccount(pk).address }; };
  k = { createdAt: new Date().toISOString(), senders: Array.from({ length: SENDERS }, make), payees: Array.from({ length: SENDERS * TABS }, make), tabs: [], stages: {}, spent: {} };
  saveKeys(k);
  console.log(`made ${k.senders.length} sender and ${k.payees.length} payee keys in keys/bench.json`);
}
const acct = (x) => accounts.privateKeyToAccount(x.pk);
const payeeOf = (s, t) => k.payees[s * TABS + t];

async function sendAll(label, signed) {
  const sent = await sendRaw(signed);
  const errs = sent.filter((s) => s.error);
  if (errs.length) console.log(`${label}: ${errs.length} send errors, first: ${errs[0].error}`);
  const got = await receipts(sent.filter((s) => !s.error).map((s) => s.hash));
  const bad = [...got.values()].filter((r) => r.status !== "0x1").length;
  const gasUsed = [...got.values()].map((r) => BigInt(r.gasUsed));
  console.log(`${label}: ${got.size}/${signed.length} landed, ${bad} reverted, gas used ${gasUsed.length ? `${gasUsed.reduce((a, b) => (a < b ? a : b))}..${gasUsed.reduce((a, b) => (a > b ? a : b))}` : "-"}`);
  return { sent, got, ok: errs.length === 0 && bad === 0 && got.size === signed.length };
}

if (!k.stages.fund) {
  if (!k.spent.keeperStart) {
    k.spent.keeperStart = (await pub.getBalance({ address: keeper.address })).toString();
    k.spent.faucetStart = (await pub.getBalance({ address: faucet.address })).toString();
    saveKeys(k);
  }
  // Only keys still empty are funded, so a rerun after a refused send tops up the gaps and nothing twice.
  const targets = [...k.senders.map((s) => [s, SENDER_MON]), ...k.payees.map((p) => [p, PAYEE_MON])];
  const bal = await rpcBatch(targets.map(([x]) => ({ method: "eth_getBalance", params: [x.address, "latest"] })));
  let n = await nonceOf(keeper.address);
  const mon = [];
  for (let i = 0; i < targets.length; i++) {
    if (BigInt(bal[i].result) > 0n) continue;
    mon.push(await sign(keeper, { to: targets[i][0].address, value: targets[i][1], gas: 21_000n, nonce: n++ }));
  }
  const a = mon.length ? await sendAll("keeper → bench keys (MON)", mon) : { ok: true };

  const each = BUDGET * BigInt(TABS);
  const tok = await rpcBatch(k.senders.map((s) => ({ method: "eth_call", params: [{ to: AUSD, data: viem.encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [s.address] }) }, "latest"] })));
  const need = k.senders.filter((_, i) => BigInt(tok[i].result) < each);
  let b = { ok: true };
  if (need.length) {
    const gas = margin(await pub.estimateGas({ account: faucet.address, to: AUSD, data: viem.encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [need[0].address, each] }) }), 5n);
    let m = await nonceOf(faucet.address);
    const ausd = [];
    for (const s of need) ausd.push(await sign(faucet, { to: AUSD, data: viem.encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [s.address, each] }), gas, nonce: m++ }));
    b = await sendAll("faucet wallet → senders (AUSD)", ausd);
  }
  if (!a.ok || !b.ok) throw new Error("funding incomplete; rerun to fill the gaps");
  k.stages.fund = new Date().toISOString();
  saveKeys(k);
}

if (!k.stages.approve) {
  const signed = [];
  for (const s of k.senders) {
    const data = viem.encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [TILL, BUDGET * BigInt(TABS)] });
    const gas = margin(await pub.estimateGas({ account: s.address, to: AUSD, data }), 5n);
    signed.push(await sign(acct(s), { to: AUSD, data, gas, nonce: await nonceOf(s.address) }));
  }
  const r = await sendAll("approve", signed);
  if (!r.ok) throw new Error("approve incomplete");
  k.stages.approve = new Date().toISOString();
  saveKeys(k);
}

if (!k.stages.open) {
  const openData = (p) => viem.encodeFunctionData({ abi: tillAbi, functionName: "open", args: [p, viem.zeroAddress, RATE, BUDGET, MEMO] });
  const est = await pub.estimateGas({ account: k.senders[0].address, to: TILL, data: openData(payeeOf(0, 0).address) });
  const gas = margin(est);
  console.log(`open: estimated ${est} gas, limit ${gas}`);
  const signed = [];
  for (let s = 0; s < k.senders.length; s++) {
    let n = await nonceOf(k.senders[s].address);
    for (let t = 0; t < TABS; t++) signed.push(await sign(acct(k.senders[s]), { to: TILL, data: openData(payeeOf(s, t).address), gas, nonce: n++ }));
  }
  const r = await sendAll("open", signed);
  k.tabs = [];
  for (const rc of r.got.values()) {
    for (const log of rc.logs) {
      try {
        const ev = viem.decodeEventLog({ abi: tillAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "Opened") k.tabs.push({ id: Number(ev.args.id), payer: ev.args.payer, payee: ev.args.payee, openHash: rc.transactionHash });
      } catch {}
    }
  }
  k.tabs.sort((a, b) => a.id - b.id);
  k.gas = { ...(k.gas || {}), open: est.toString() };
  saveKeys(k);
  console.log(`tabs opened: ${k.tabs.length}, ids ${k.tabs[0]?.id}..${k.tabs.at(-1)?.id}`);
  if (!r.ok) throw new Error("open incomplete");
  k.stages.open = new Date().toISOString();
  saveKeys(k);
}

if (!k.stages.clockIn) {
  const byAddr = new Map(k.payees.map((p) => [p.address.toLowerCase(), p]));
  const data = (id) => viem.encodeFunctionData({ abi: tillAbi, functionName: "clockIn", args: [BigInt(id)] });
  // Only tabs whose clock is not running yet; each is estimated on its own (a tab's first write costs more).
  const views = await rpcBatch(k.tabs.map((t) => ({ method: "eth_call", params: [{ to: TILL, data: viem.encodeFunctionData({ abi: tillAbi, functionName: "getTab", args: [BigInt(t.id)] }) }, "latest"] })));
  const todo = k.tabs.filter((t, i) => viem.decodeFunctionResult({ abi: tillAbi, functionName: "getTab", data: views[i].result }).tab.since === 0n);
  const signed = [];
  for (const t of todo) {
    const p = byAddr.get(t.payee.toLowerCase());
    let est;
    try {
      est = await pub.estimateGas({ account: p.address, to: TILL, data: data(t.id) });
    } catch (e) {
      console.log(`clockIn ${t.id}: ${e.shortMessage}`);
      continue;
    }
    signed.push(await sign(acct(p), { to: TILL, data: data(t.id), gas: margin(est), nonce: await nonceOf(p.address) }));
    k.gas = { ...(k.gas || {}), clockIn: est.toString() };
  }
  console.log(`clockIn: ${todo.length} tabs to clock in`);
  const r = signed.length ? await sendAll("clockIn", signed) : { ok: true };
  if (!r.ok || signed.length < todo.length) throw new Error("clock-in incomplete; rerun");
  k.stages.clockIn = new Date().toISOString();
  saveKeys(k);
}

console.log(`ready: ${k.tabs.length} running tabs from ${k.senders.length} senders`);
console.log(`keeper now ${fmt(await pub.getBalance({ address: keeper.address }))} MON (started ${fmt(BigInt(k.spent.keeperStart))})`);
