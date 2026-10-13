/**
 * Step 4: leave nothing behind. Closes every benchmark tab (the freelancer gets what they earned, the rest of
 * the budget goes back to the sender), sends all AUSD from the bench keys to the project's faucet wallet, then
 * returns all MON to the keeper.
 *
 *   node scripts/bench/teardown.mjs
 *
 * The MON sweep is each key's only transaction in its last few blocks, so Monad's reserve-balance rule lets it
 * empty the account (an "emptying transaction"); its fee is priced at exactly base fee + tip so no dust is left.
 */
import { viem, accounts, pub, envKey, loadKeys, saveKeys, TILL, AUSD, FAUCET_WALLET, tillAbi, erc20Abi, sign, sendRaw, receipts, rpcBatch, nonceOf, sleep, fmt } from "./lib.mjs";

const k = loadKeys();
const keeper = accounts.privateKeyToAccount(envKey("KEEPER_KEY")).address;
const acct = (x) => accounts.privateKeyToAccount(x.pk);
const margin = (g, pct = 5n) => (g * (100n + pct)) / 100n;
const keys = [...k.senders, ...k.payees, ...(k.solo ? [k.solo] : [])];

async function sendAll(label, signed) {
  if (!signed.length) return;
  const sent = await sendRaw(signed);
  const errs = sent.filter((s) => s.error);
  const got = await receipts(sent.filter((s) => !s.error).map((s) => s.hash));
  const bad = [...got.values()].filter((r) => r.status !== "0x1").length;
  console.log(`${label}: ${got.size}/${signed.length} landed, ${bad} reverted, ${errs.length} refused${errs[0] ? ` (${errs[0].error})` : ""}`);
}

// 1. Close every tab that is still open, each with its own estimate.
{
  const views = await rpcBatch(k.tabs.map((t) => ({ method: "eth_call", params: [{ to: TILL, data: viem.encodeFunctionData({ abi: tillAbi, functionName: "getTab", args: [BigInt(t.id)] }) }, "latest"] })));
  const open = k.tabs.filter((t, i) => !viem.decodeFunctionResult({ abi: tillAbi, functionName: "getTab", data: views[i].result }).tab.closed);
  const nonce = new Map();
  const signed = [];
  for (const t of open) {
    const s = k.senders.find((x) => x.address.toLowerCase() === t.payer.toLowerCase());
    const data = viem.encodeFunctionData({ abi: tillAbi, functionName: "close", args: [BigInt(t.id)] });
    const gas = margin(await pub.estimateGas({ account: s.address, to: TILL, data }));
    if (!nonce.has(s.address)) nonce.set(s.address, await nonceOf(s.address));
    const n = nonce.get(s.address);
    nonce.set(s.address, n + 1);
    signed.push(await sign(acct(s), { to: TILL, data, gas, nonce: n }));
  }
  await sendAll(`close ${open.length} tabs`, signed);
}

// 2. All AUSD back to the faucet wallet.
{
  const bal = await rpcBatch(keys.map((x) => ({ method: "eth_call", params: [{ to: AUSD, data: viem.encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [x.address] }) }, "latest"] })));
  const signed = [];
  let total = 0n;
  for (let i = 0; i < keys.length; i++) {
    const amount = BigInt(bal[i].result);
    if (amount === 0n) continue;
    total += amount;
    const data = viem.encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [FAUCET_WALLET, amount] });
    const gas = margin(await pub.estimateGas({ account: keys[i].address, to: AUSD, data }));
    signed.push(await sign(acct(keys[i]), { to: AUSD, data, gas, nonce: await nonceOf(keys[i].address) }));
  }
  await sendAll(`AUSD sweep (${Number(total) / 1e6} AUSD)`, signed);
  k.spent.ausdReturned = ((BigInt(k.spent.ausdReturned || "0")) + total).toString();
  saveKeys(k);
}

// 3. All MON back to the keeper, once every key has been quiet for a few blocks.
{
  await sleep(4000);
  const block = await pub.getBlock();
  const price = block.baseFeePerGas + 2_000_000_000n;
  const fee = 21_000n * price;
  const bal = await rpcBatch(keys.map((x) => ({ method: "eth_getBalance", params: [x.address, "latest"] })));
  const signed = [];
  let total = 0n;
  for (let i = 0; i < keys.length; i++) {
    const b = BigInt(bal[i].result);
    if (b <= fee) continue;
    total += b - fee;
    signed.push(await sign(acct(keys[i]), { to: keeper, value: b - fee, gas: 21_000n, nonce: await nonceOf(keys[i].address), maxFeePerGas: price, maxPriorityFeePerGas: 2_000_000_000n }));
  }
  await sendAll(`MON sweep (${fmt(total)} MON)`, signed);
  k.spent.monReturned = ((BigInt(k.spent.monReturned || "0")) + total).toString();
  saveKeys(k);
}

const left = await rpcBatch(keys.map((x) => ({ method: "eth_getBalance", params: [x.address, "latest"] })));
const dust = left.reduce((a, r) => a + BigInt(r.result), 0n);
console.log(`left on bench keys: ${fmt(dust)} MON; keeper now ${fmt(await pub.getBalance({ address: keeper }))} MON`);
