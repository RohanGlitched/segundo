/** Balances of every bench key and the keeper's nonce state; never prints keys. */
import { accounts, pub, envKey, loadKeys, rpcBatch, AUSD, erc20Abi, viem, nonceOf, fmt } from "./lib.mjs";
const k = loadKeys();
const keeper = accounts.privateKeyToAccount(envKey("KEEPER_KEY")).address;
console.log("keeper nonce latest", await nonceOf(keeper, "latest"), "pending", await nonceOf(keeper, "pending"), "MON", fmt(await pub.getBalance({ address: keeper })));
const all = [...k.senders.map((s, i) => ["s" + i, s.address]), ...k.payees.map((p, i) => ["p" + i, p.address])];
const bal = await rpcBatch(all.map(([, a]) => ({ method: "eth_getBalance", params: [a, "latest"] })), undefined, 30);
const tok = await rpcBatch(all.map(([, a]) => ({ method: "eth_call", params: [{ to: AUSD, data: viem.encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [a] }) }, "latest"] })), undefined, 30);
let zero = [], monSum = 0n, ausdSum = 0n;
all.forEach(([n], i) => { const b = BigInt(bal[i].result); const t = BigInt(tok[i].result); monSum += b; ausdSum += t; if (b === 0n) zero.push(n); if (process.argv.includes("-v")) console.log(n, fmt(b), Number(t) / 1e6); });
console.log("unfunded:", zero.join(",") || "none", "| total MON", fmt(monSum), "| total AUSD", Number(ausdSum) / 1e6);
