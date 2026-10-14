/**
 * Till's seeded people: three client studios and five freelancers who keep real tabs running on
 * Monad testnet, so the site always shows live pay. Freelancers clock in and out around their own
 * local working hours, staggered so that at least three of the five are on the clock at any minute
 * of the UTC day, and any freelancer hired by someone else (a judge) clocks in within seconds.
 * Every action is signed by the bot and submitted gaslessly through the forwarder by the keeper,
 * which also settles running tabs every fifteen minutes. Like any client, the studios pay Segundo's 1% fee
 * on every budget and top-up: a signed AUSD transfer to the treasury, sent right after the tab is funded.
 *
 *   RPC_URL=... TILL=0x... FORWARDER=0x... KEYS=keys/wallets.json node bots/till-bots.mjs
 */
import fs from "node:fs";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, hexToSignature, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.RPC_URL || "https://testnet-rpc.monad.xyz";
const TILL = process.env.TILL;
const FORWARDER = process.env.FORWARDER;
const DOLLAR = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC"; // Agora AUSD on Monad testnet
const AGORA_FAUCET = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C";
const TREASURY = process.env.TREASURY || "0xAdF0F9443EafD19916cBd8f7541ea5e19e69F62c"; // Segundo's treasury: the 1% client fee
const keys = JSON.parse(fs.readFileSync(process.env.KEYS || "keys/wallets.json", "utf8"));
const TICK_MS = Number(process.env.TICK_MS || 4000);
const SETTLE_EVERY_MS = Number(process.env.SETTLE_EVERY_MS || 900_000);
// When run from cron each minute, exit before the next run starts (cron + flock restart it).
const RUN_FOR_MS = Number(process.env.RUN_FOR_MS || 0);
// MON is the scarce resource on testnet, so the seeded tabs run lean on transactions: top-ups of
// $120 (one every few hours, not every hour), two work blocks a day, and one batched settle of
// every running tab each fifteen minutes (pay accrues by the second on chain in between; a watched
// tab page pays out on its own).
const usd = (n) => BigInt(Math.round(n * 1e6));
/** Segundo's fee: 1% of a budget or top-up, rounded up to the next AUSD unit (same rule as web/lib/money.ts). */
const feeFor = (amount) => (amount <= 0n ? 0n : (amount + 99n) / 100n);
// AUSD comes from Agora's on-chain faucet, so studios fund themselves and budgets can be realistic.
const BUDGET = usd(Number(process.env.BUDGET || 40));
const TOPUP = usd(Number(process.env.TOPUP || 120));
const RECYCLE_ABOVE = usd(Number(process.env.RECYCLE_ABOVE || 1_000_000));
const STARTED = Date.now();

const chain = defineChain({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const keeper = createWalletClient({ account: privateKeyToAccount(keys.keeper.privateKey), chain, transport: http(RPC) });
const faucet = createWalletClient({ account: privateKeyToAccount(keys.deployer.privateKey), chain, transport: http(RPC) });

const tillAbi = parseAbi([
  "function tabsOf(address) view returns (uint256[])",
  "function getTabs(uint256[] ids) view returns ((uint256 id,(address payer,uint64 rate,bool held,bool closed,address payee,uint64 since,address invite,uint64 lastBlock,uint128 budget,uint128 banked,uint128 paid) tab,uint256 earned,uint256 owed,uint256 runway)[])",
  "function profileOf(address) view returns ((string name,string place,bytes3 currency))",
  "function setProfile(string name,string place,bytes3 currency)",
  "function openWithPermit(address payee,address invite,uint64 rate,uint128 budget,string memo,uint256 deadline,uint8 v,bytes32 r,bytes32 s) returns (uint256)",
  "function topUpWithPermit(uint256 id,uint128 amount,uint256 deadline,uint8 v,bytes32 r,bytes32 s)",
  "function clockIn(uint256 id)",
  "function clockOut(uint256 id)",
  "function close(uint256 id)",
  "function settle(uint256 id) returns (uint128)",
  "function settleMany(uint256[] ids) returns (uint256)",
]);
const fwdAbi = parseAbi([
  "function nonces(address) view returns (uint256)",
  "function execute((address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) payable",
]);
const dollarAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function nonces(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)",
]);

// UTC offsets are fixed here; good enough to keep each person to plausible local hours. Shifts are
// local hours [start, end) with an hour's break; a day can run past midnight ([.., 24] then [0, ..]).
// The days are long and staggered so that at least three of the five are on the clock at every
// minute of the UTC day (judges open the site from every time zone): Ana starts at dawn in Manila,
// Priya keeps office hours, Wanjiru, Tunde and Lucas work into the night. Each day ends 15 minutes
// after the next person's starts, so a slow clock-in never drops the count to two (coverage() checks
// this at every start).
const DAY = [[9, 12], [14, 18]];
const CLIENTS = [
  { key: "bot1", name: "Northwind Studio", place: "Berlin", cur: "EUR" },
  { key: "bot2", name: "Lumen Labs", place: "Austin", cur: "USD" },
  { key: "bot3", name: "Kite & Co", place: "Singapore", cur: "SGD" },
];
const FREELANCERS = [
  { key: "bot4", name: "Ana Reyes", place: "Manila", cur: "PHP", utc: 8, client: "bot1", rate: 32, memo: "Brand system for autumn launch", shifts: [[5, 10.25], [11, 20.25]] },
  { key: "bot5", name: "Tunde Bakare", place: "Lagos", cur: "NGN", utc: 1, client: "bot2", rate: 45, memo: "Payments API integration", shifts: [[12, 16.25], [17, 24], [0, 4.25]] },
  { key: "bot6", name: "Priya Nair", place: "Pune", cur: "INR", utc: 5.5, client: "bot1", rate: 28, memo: "Illustrations for the help centre", shifts: [[7.5, 11.75], [12.5, 21.75]] },
  { key: "bot7", name: "Lucas Almeida", place: "São Paulo", cur: "BRL", utc: -3, client: "bot3", rate: 30, memo: "Product launch video", shifts: [[12, 18.25], [19, 24], [0, 4.25]] },
  { key: "bot8", name: "Wanjiru Kamau", place: "Nairobi", cur: "KES", utc: 3, client: "bot2", rate: 26, memo: "Website copy, five pages", shifts: [[9, 14.25], [15, 24], [0, 1.25]] },
];
const acct = (k) => privateKeyToAccount(keys[k].privateKey);
const BOT_ADDRS = new Set(Object.keys(keys).filter((k) => k.startsWith("bot")).map((k) => acct(k).address.toLowerCase()));

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const bytes3 = (s) => `0x${Buffer.from(s).toString("hex").padEnd(6, "0")}`;

let keeperNonce = null;
/** Monad charges the gas limit, so every send uses the chain's estimate plus 15% (never less than minGas). */
async function sendFromKeeper(to, data, minGas = 0n) {
  if (keeperNonce == null) keeperNonce = await pub.getTransactionCount({ address: keeper.account.address, blockTag: "pending" });
  try {
    const est = await pub.estimateGas({ account: keeper.account.address, to, data });
    const gas = (est * 115n) / 100n > minGas ? (est * 115n) / 100n : minGas;
    const hash = await keeper.sendTransaction({ to, data, gas, nonce: keeperNonce++ });
    const r = await pub.waitForTransactionReceipt({ hash, pollingInterval: 300, timeout: 60_000 });
    if (r.status !== "success") throw new Error(`reverted ${hash}`);
    return hash;
  } catch (e) {
    keeperNonce = null;
    throw e;
  }
}

async function forward(k, fn, args) {
  const account = acct(k);
  const data = encodeFunctionData({ abi: tillAbi, functionName: fn, args });
  const est = await pub.estimateGas({ account: FORWARDER, to: TILL, data: `${data}${account.address.slice(2)}` });
  const gas = (est * 125n) / 100n + 5_000n;
  const nonce = await pub.readContract({ address: FORWARDER, abi: fwdAbi, functionName: "nonces", args: [account.address] });
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const message = { from: account.address, to: TILL, value: 0n, gas, nonce, deadline, data };
  const signature = await account.signTypedData({
    domain: { name: "Till", version: "1", chainId: chain.id, verifyingContract: FORWARDER },
    types: {
      ForwardRequest: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "gas", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" }, { name: "data", type: "bytes" },
      ],
    },
    primaryType: "ForwardRequest",
    message,
  });
  const exec = encodeFunctionData({ abi: fwdAbi, functionName: "execute", args: [{ ...message, signature }] });
  return sendFromKeeper(FORWARDER, exec, gas + 70_000n);
}

async function permit(k, value) {
  const account = acct(k);
  const nonce = await pub.readContract({ address: DOLLAR, abi: dollarAbi, functionName: "nonces", args: [account.address] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const sig = await account.signTypedData({
    domain: { name: "Agora Dollar", version: "1", chainId: chain.id, verifyingContract: DOLLAR },
    types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Permit",
    message: { owner: account.address, spender: TILL, value, nonce, deadline },
  });
  const { v, r, s } = hexToSignature(sig);
  return { deadline, v: Number(v), r, s };
}

/** Moves AUSD out of a bot's wallet with a signed transferWithAuthorization (EIP-3009) the keeper submits. */
async function authorize(fromKey, to, value) {
  const from = acct(fromKey);
  const nonce = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const sig = await from.signTypedData({
    domain: { name: "Agora Dollar", version: "1", chainId: chain.id, verifyingContract: DOLLAR },
    types: { TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
    primaryType: "TransferWithAuthorization",
    message: { from: from.address, to, value, validAfter: 0n, validBefore, nonce },
  });
  const { v, r, s } = hexToSignature(sig);
  const data = encodeFunctionData({ abi: dollarAbi, functionName: "transferWithAuthorization", args: [from.address, to, value, 0n, validBefore, nonce, Number(v), r, s] });
  return sendFromKeeper(DOLLAR, data);
}

/** A freelancer passes their pay back to their client now and then, so the demo money keeps circulating. */
const recycle = (fromKey, toKey, value) => authorize(fromKey, acct(toKey).address, value);

/** The studio pays Segundo's 1% on money it just put into a tab. A failure is logged loudly; the tab stands either way. */
async function payFee(c, amount, what) {
  const fee = feeFor(amount);
  try {
    const hash = await authorize(c.key, TREASURY, fee);
    log(`${c.name} paid the ${(Number(fee) / 1e6).toFixed(2)} AUSD Segundo fee on ${what} (${hash})`);
  } catch (e) {
    log(`!!! FEE NOT COLLECTED: ${c.name} on ${what}:`, e.shortMessage || e.message);
  }
}

const dollarOf = (a) => pub.readContract({ address: DOLLAR, abi: dollarAbi, functionName: "balanceOf", args: [a] });

/**
 * Is this freelancer at work? Their own shifts in their own time zone (see FREELANCERS): two blocks
 * a day with a break between, so each person clocks in and out only a couple of times a day.
 */
function onShift(f, now = new Date()) {
  const localMin = (now.getUTCHours() * 60 + now.getUTCMinutes() + f.utc * 60 + 1440) % 1440;
  if (process.env.ALWAYS_ON) return true;
  return (f.shifts || DAY).some(([a, b]) => localMin >= a * 60 && localMin < b * 60);
}

/** The fewest freelancers on shift at any minute of the UTC day, and who is on shift right now. */
function coverage(now = new Date()) {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let fewest = FREELANCERS.length;
  for (let m = 0; m < 1440; m++) fewest = Math.min(fewest, FREELANCERS.filter((f) => onShift(f, new Date(day + m * 60_000))).length);
  return { fewest, now: FREELANCERS.filter((f) => onShift(f, now)).map((f) => f.name.split(" ")[0]) };
}

async function ensureProfiles() {
  for (const p of [...CLIENTS, ...FREELANCERS]) {
    const cur = await pub.readContract({ address: TILL, abi: tillAbi, functionName: "profileOf", args: [acct(p.key).address] });
    if (cur.name === p.name) continue;
    await forward(p.key, "setProfile", [p.name, p.place, bytes3(p.cur)]);
    log(`profile set: ${p.name}, ${p.place}`);
  }
}

/** Studios top themselves up from Agora's testnet faucet (10,000 AUSD a call); the faucet wallet pays the gas. */
async function ensureClientFunds() {
  for (const c of CLIENTS) {
    const bal = await dollarOf(acct(c.key).address);
    if (bal >= (BUDGET + feeFor(BUDGET)) * 2n) continue;
    const data = encodeFunctionData({ abi: parseAbi(["function requestFunds(address recipient)"]), functionName: "requestFunds", args: [acct(c.key).address] });
    const est = await pub.estimateGas({ account: faucet.account.address, to: AGORA_FAUCET, data });
    const hash = await faucet.sendTransaction({ to: AGORA_FAUCET, data, gas: (est * 115n) / 100n });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`funding ${c.name} reverted`);
    log(`${c.name} topped up from Agora's AUSD faucet`);
  }
}

// Across cron runs, remember when running tabs were last settled.
const SETTLE_STAMP = process.env.SETTLE_STAMP || "";
let lastSettle = SETTLE_STAMP && fs.existsSync(SETTLE_STAMP) ? Number(fs.readFileSync(SETTLE_STAMP, "utf8")) || 0 : 0;

/** Below this the keeper only clocks people out and settles; nobody opens or tops up. Logged loudly every tick. */
const KEEPER_LOW = 150_000_000_000_000_000n; // 0.15 MON
let keeperLow = false;

async function tick() {
  const now = Math.floor(Date.now() / 1000);
  const due = new Map();
  const mon = await pub.getBalance({ address: keeper.account.address });
  keeperLow = mon < KEEPER_LOW;
  if (keeperLow) log(`!!! KEEPER LOW ON MON: ${(Number(mon) / 1e18).toFixed(3)} MON at ${keeper.account.address}. Top it up (node bots/topup.mjs keeper=10) or clock-ins stop.`);
  for (const f of FREELANCERS) {
    // One person's failed step (a dropped RPC call, a reverted clock-in) must not stop the others.
    try {
      await person(f, now, due);
    } catch (e) {
      log(`${f.name}:`, e.shortMessage || e.message);
    }
  }

  if (Date.now() - lastSettle > SETTLE_EVERY_MS) {
    const ids = [...due.keys()];
    if (ids.length) {
      try {
        await sendFromKeeper(TILL, encodeFunctionData({ abi: tillAbi, functionName: "settleMany", args: [ids] }));
        log(`settled ${ids.length} tabs`);
      } catch (e) {
        // One tab that can't be paid (say a frozen AUSD account) must not hold up the others.
        log("batch settle failed, settling one by one:", e.shortMessage || e.message);
        for (const id of ids) {
          try {
            await sendFromKeeper(TILL, encodeFunctionData({ abi: tillAbi, functionName: "settle", args: [id] }));
          } catch (err) {
            log(`settle ${id}:`, err.shortMessage || err.message);
          }
        }
      }
    }
    lastSettle = Date.now();
    if (SETTLE_STAMP) fs.writeFileSync(SETTLE_STAMP, String(lastSettle));
  }
}

async function person(f, now, due) {
  {
    const me = acct(f.key).address;
    const ids = await pub.readContract({ address: TILL, abi: tillAbi, functionName: "tabsOf", args: [me] });
    const views = [];
    for (let i = 0; i < ids.length; i += 80) views.push(...(await pub.readContract({ address: TILL, abi: tillAbi, functionName: "getTabs", args: [ids.slice(i, i + 80)] })));
    let ownTab = null;
    let newClockIns = 0;
    for (const v of views) {
      const t = v.tab;
      if (t.closed || t.payee.toLowerCase() !== me.toLowerCase()) continue;
      const spent = v.earned >= t.budget;
      const fromBot = BOT_ADDRS.has(t.payer.toLowerCase());
      if (fromBot && t.payer.toLowerCase() === acct(f.client).address.toLowerCase()) ownTab = v;
      // Anything owed on an open tab gets paid at the next settle, including the last cents of a
      // tab whose budget ran out or whose clock stopped.
      if (v.owed > 50_000n) due.set(v.id, true);
      if (!fromBot) {
        // Hired by someone else (a judge): clock in straight away and work until the budget runs out
        // or 45 minutes pass, whichever comes first.
        if (t.since === 0n && !t.held && !spent && !keeperLow) {
          const worked = Number(t.banked) * 3600 / Math.max(1, Number(t.rate));
          // Dust tabs cost the relayer three transactions each; a demo freelancer only takes real ones, one per tick.
          if (worked < 45 * 60 && t.budget >= 500_000n && newClockIns < 1) {
            newClockIns++;
            await forward(f.key, "clockIn", [v.id]);
            log(`${f.name} clocked in on tab ${v.id} for a new client`);
          }
        } else if (t.since > 0n && now - Number(t.since) > 45 * 60) {
          await forward(f.key, "clockOut", [v.id]);
          log(`${f.name} clocked out of tab ${v.id} after 45 minutes`);
        }
      }
    }

    // Their regular client: keep one tab open, topped up, and follow working hours.
    const client = CLIENTS.find((c) => c.key === f.client);
    if (keeperLow) {
      // Keep the gas for clock-outs: no new tabs, top-ups or clock-ins until the keeper is refilled.
      if (ownTab && ownTab.tab.since > 0n && !onShift(f)) {
        await forward(f.key, "clockOut", [ownTab.id]);
        log(`${f.name} clocked out (tab ${ownTab.id})`);
      }
      return;
    }
    if (!ownTab) {
      const budget = BUDGET;
      // The budget and the 1% fee both leave the studio's wallet, so both must be there first.
      if ((await dollarOf(acct(client.key).address)) < budget + feeFor(budget)) return;
      const p = await permit(client.key, budget);
      await forward(client.key, "openWithPermit", [me, "0x0000000000000000000000000000000000000000", BigInt(f.rate * 1e6), budget, f.memo, p.deadline, p.v, p.r, p.s]);
      log(`${client.name} opened a tab for ${f.name}`);
      await payFee(client, budget, `a new tab for ${f.name}`);
      return;
    }
    const t = ownTab.tab;
    const left = t.budget - ownTab.earned;
    if (left < 1_000_000n && onShift(f)) {
      const amount = TOPUP;
      if ((await dollarOf(acct(client.key).address)) >= amount + feeFor(amount)) {
        const p = await permit(client.key, amount);
        await forward(client.key, "topUpWithPermit", [ownTab.id, amount, p.deadline, p.v, p.r, p.s]);
        log(`${client.name} topped up ${f.name}'s tab ${ownTab.id}`);
        await payFee(client, amount, `the top-up of tab ${ownTab.id}`);
      }
    }
    const want = onShift(f);
    if (want && t.since === 0n && !t.held && ownTab.earned < t.budget) {
      await forward(f.key, "clockIn", [ownTab.id]);
      log(`${f.name} clocked in (tab ${ownTab.id})`);
    } else if (!want && t.since > 0n) {
      await forward(f.key, "clockOut", [ownTab.id]);
      log(`${f.name} clocked out (tab ${ownTab.id})`);
    }

    // Pass earnings back to the client so the loop never runs dry.
    const earnedBal = await dollarOf(me);
    if (earnedBal > RECYCLE_ABOVE) {
      await recycle(f.key, f.client, earnedBal - 1_000_000n);
      log(`${f.name} sent ${(Number(earnedBal - 1_000_000n) / 1e6).toFixed(2)} AUSD back to ${client.name}`);
    }
  }
}

async function main() {
  if (!TILL || !FORWARDER) throw new Error("Set TILL and FORWARDER.");
  const cover = coverage();
  log(`till bots on ${RPC}, keeper ${keeper.account.address}; on shift now: ${cover.now.join(", ")}; fewest on shift all day: ${cover.fewest}`);
  if (cover.fewest < 3) log(`!!! SHIFTS LEAVE ONLY ${cover.fewest} ON THE CLOCK at some hour of the day`);
  if (!process.env.SKIP_PROFILES) await ensureProfiles().catch((e) => log("profiles:", e.shortMessage || e.message));
  for (;;) {
    if (RUN_FOR_MS && Date.now() - STARTED > RUN_FOR_MS) return;
    // Funding and the tick fail separately: a faucet cooldown must never stop clock-outs and settles.
    await ensureClientFunds().catch((e) => log("funding:", e.shortMessage || e.message));
    await tick().catch((e) => log("error:", e.shortMessage || e.message));
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

main();
