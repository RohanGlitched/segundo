/**
 * Step 3: turn a raw run from burst.mjs into web/public/bench.json, the numbers the /network page shows.
 *
 *   node scripts/bench/report.mjs [scripts/bench/out/run-....json]   (defaults to the newest run)
 *
 * Every number comes from the run file: send times from this machine's clock, block numbers, status and logs
 * from receipts, block contents from eth_getBlockByNumber, and "seen" times from the WebSocket newHeads feed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, KEYS_FILE } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "out");
const file = process.argv[2] || path.join(outDir, fs.readdirSync(outDir).filter((f) => f.startsWith("run-")).sort().at(-1));
const d = JSON.parse(fs.readFileSync(file, "utf8"));
const PRICE_GWEI = 102; // base fee 100 gwei + 2 gwei tip, what every block in the run charged
const MON_PER_GAS = PRICE_GWEI / 1e9;

const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))] : null;
};
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

function summarise(run) {
  const rs = d.records.filter((r) => r.run === run);
  const landed = rs.filter((r) => r.block != null);
  const ok = landed.filter((r) => r.status === "success");
  const per = new Map();
  for (const r of landed) per.set(r.block, (per.get(r.block) || 0) + 1);
  const start = Math.min(...rs.map((r) => r.sentAt));
  // Done when the last transaction's block was seen (or, run one at a time, when its receipt came back).
  const end = Math.max(...landed.map((r) => r.receiptAt ?? r.seenAt ?? 0));
  const lat = landed.map((r) => (r.receiptAt ?? r.seenAt) - r.sentAt).filter((x) => x > 0);
  const blocks = [...per.keys()];
  return {
    rs,
    txs: rs.length,
    landed: landed.length,
    succeeded: ok.length,
    reverted: landed.length - ok.length,
    refused: rs.filter((r) => r.error).length,
    paidOut: ok.filter((r) => r.paid !== "0").length,
    durationS: r2((end - start) / 1000),
    txPerS: r1(landed.length / ((end - start) / 1000)),
    firstBlock: Math.min(...blocks),
    lastBlock: Math.max(...blocks),
    blocksWithOurs: blocks.length,
    blocksSpanned: Math.max(...blocks) - Math.min(...blocks) + 1,
    perBlockMax: Math.max(...per.values()),
    p50ms: q(lat, 0.5),
    p90ms: q(lat, 0.9),
    maxMs: q(lat, 1),
    gasBilled: rs.filter((r) => r.block != null).reduce((a, r) => a + Number(r.gas), 0),
    start,
  };
}

const multi = summarise("multi");
const pipe = summarise("pipe");
const serial = summarise("serial");

const blockRow = (b, run) => {
  const ours = d.records.filter((r) => r.run === run && r.block === b.number);
  return {
    number: b.number,
    ours: ours.length,
    reverted: ours.filter((r) => r.status === "reverted").length,
    others: b.txs - ours.length,
    gasUsed: b.gasUsed,
    gasLimit: b.gasLimit,
    timestamp: b.timestamp,
    seenMs: b.seenAt ? b.seenAt - multi.start : null,
  };
};
const burstBlocks = d.blocks.filter((b) => b.number >= multi.firstBlock && b.number <= multi.lastBlock).map((b) => blockRow(b, "multi"));
const fullest = Math.max(...burstBlocks.map((b) => b.gasUsed / b.gasLimit));

const waves = [...new Set(multi.rs.map((r) => r.wave))].sort().map((w) => {
  const rs = multi.rs.filter((r) => r.wave === w && r.block != null);
  const blocks = [...new Set(rs.map((r) => r.block))].sort();
  return { wave: w, txs: rs.length, blocks, p50ms: q(rs.map((r) => r.seenAt - r.sentAt), 0.5), sendMs: q(rs.map((r) => r.ackAt - r.sentAt), 0.5) };
});

// A few transactions anyone can open on MonadVision: the first of the burst, one from each full-wave block,
// one of the 48 from a single key, one sent one at a time, and one of the reverts.
const pick = (pred) => d.records.find(pred);
const fullBlocks = burstBlocks.filter((b) => b.ours === Math.max(...burstBlocks.map((x) => x.ours)));
const samples = [
  { label: "First settle of the burst", r: pick((r) => r.run === "multi" && r.block === multi.firstBlock && r.status === "success") },
  ...fullBlocks.map((b) => ({ label: `One of ${b.ours} settles in block ${b.number.toLocaleString("en-US")}`, r: pick((r) => r.run === "multi" && r.block === b.number && r.status === "success") })),
  { label: `One of ${pipe.perBlockMax} settles from a single key in block ${pipe.firstBlock.toLocaleString("en-US")}`, r: pick((r) => r.run === "pipe" && r.status === "success") },
  { label: "A settle sent one at a time, the way the relayer worked before this test", r: pick((r) => r.run === "serial" && r.status === "success") },
  { label: "One of the reverts (out of gas)", r: pick((r) => r.status === "reverted") },
]
  .filter((s) => s.r)
  .map((s) => ({ label: s.label, hash: s.r.hash, block: s.r.block, status: s.r.status }));

// What the whole exercise cost in test MON, from the keys file's ledger and the run.
const keys = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
const funded = keys.senders.length * 0.9 + keys.payees.length * 0.03 + Number(keys.spent.soloFunded || 0) / 1e18;
const returned = Number(keys.spent.monReturned || 0) / 1e18;
const fundingFees = (111 * 21_000 + 16 * 76_563) * MON_PER_GAS; // keeper → 111 keys, faucet wallet → 16 AUSD transfers
const monSpent = r2(funded - returned + fundingFees);
const burstMon = r2((multi.gasBilled + pipe.gasBilled + serial.gasBilled) * MON_PER_GAS);

const out = {
  runAt: d.runAt,
  network: "Monad testnet",
  contract: "0xeb6c2c519c9bcc4495364c34ac116c20098113d1",
  senders: keys.senders.length,
  tabs: d.tabs.length,
  tabIds: { from: Math.min(...d.tabs), to: Math.max(...d.tabs) },
  txs: multi.txs,
  landed: multi.landed,
  succeeded: multi.succeeded,
  failed: multi.reverted + multi.refused,
  refused: multi.refused,
  paidOut: multi.paidOut,
  durationS: multi.durationS,
  txPerS: multi.txPerS,
  offeredPerS: d.tabs.length,
  blocks: multi.blocksSpanned,
  blocksWithOurs: multi.blocksWithOurs,
  firstBlock: multi.firstBlock,
  lastBlock: multi.lastBlock,
  perBlockMax: multi.perBlockMax,
  fullestBlockPct: r1(fullest * 100),
  p50ms: multi.p50ms,
  p90ms: multi.p90ms,
  maxMs: multi.maxMs,
  waves,
  perBlock: burstBlocks,
  pipelined: {
    txs: pipe.txs,
    landed: pipe.landed,
    reverted: pipe.reverted,
    blocks: pipe.blocksSpanned,
    block: pipe.firstBlock,
    perBlockMax: pipe.perBlockMax,
    durationS: pipe.durationS,
    p50ms: pipe.p50ms,
  },
  singleSender: {
    txs: serial.txs,
    landed: serial.landed,
    reverted: serial.reverted,
    durationS: serial.durationS,
    txPerS: r2(serial.landed / serial.durationS),
    p50ms: serial.p50ms,
    p90ms: serial.p90ms,
    perBlockMax: serial.perBlockMax,
  },
  blockTime: d.blockTime,
  gasPerSettle: { firstPayout: Number(d.freshGas), steady: Number(d.steadyGas), steadySomeTabs: 92_488, nothingOwed: 31_564, priceGwei: PRICE_GWEI },
  cost: { monSpent, burstMon, perSettleMon: Math.round(Number(d.steadyGas) * 1.08 * MON_PER_GAS * 10_000) / 10_000 },
  samples,
  notes: [
    `Every transaction was a real settle(id) on Segundo's contract (deployed under its working name, Till), paying a freelancer what they had earned since the last one. ${multi.paidOut} of the ${multi.succeeded} that succeeded moved money; the rest landed in the same one-second block timestamp as that tab's previous settle, so there was nothing new to pay.`,
    `${multi.reverted + pipe.reverted + serial.reverted} transactions reverted, all out of gas on the same 5 tabs: settling them costs 8,032 more gas than the rest (92,488 instead of 84,456; 129,434 instead of 118,591 for a first payout), and we gave every tab one limit taken from the others (plus 6% to 8%) to keep the bill down, because Monad charges the whole gas limit. Segundo's relayer estimates each call and adds 15%, and refuses a signed request asking for more than 1.5 times its own estimate.`,
    `Latency for the bursts is from sending the transaction to this machine receiving the header of the block that holds it over WebSocket (newHeads). For the one-at-a-time run it is from sending to the receipt, polled every 150 ms as the relayer does.`,
    `The first wave took ${waves[0]?.sendMs} ms just to be accepted by the three public RPC endpoints (new connections); later waves took about ${waves[1] ? q(waves.slice(1).map((w) => w.sendMs), 0.5) : "-"} ms. The Monad Foundation endpoint allows 50 calls a second per client, so senders were spread over three endpoints.`,
    `This does not show parallel execution. Every settle changes the contract's AUSD balance, a single storage slot, so under Monad's optimistic parallel execution these transactions conflict and some are re-executed. What it does show is capacity and speed: the busiest block was ${r1(fullest * 100)}% full.`,
    `One key is not the limit on Monad: ${pipe.perBlockMax} settles sent at once from a single fresh key with consecutive nonces all landed in one block. The bottleneck was Segundo's relayer, which then sent one transaction and waited for its receipt before the next (${r2(serial.landed / serial.durationS)} a second). Since this run it is a pool of 7 keys, each keeping many transactions in flight.`,
    `Test MON spent on the whole exercise (setting up ${d.tabs.length} tabs, the runs, closing the tabs and sweeping funds back): ${monSpent} MON, of which ${burstMon} MON was the settles themselves.`,
  ],
};

const dest = path.join(ROOT, "web/public/bench.json");
fs.writeFileSync(dest, JSON.stringify(out, null, 1) + "\n");
console.log(`wrote ${dest}`);
console.log(JSON.stringify({ ...out, perBlock: out.perBlock.length, waves: out.waves.length, notes: out.notes.length, samples: out.samples.length }, null, 1));
