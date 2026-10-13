# Segundo on Monad, measured: the load benchmark

These scripts produced `web/public/bench.json` and the numbers on [segundo.world/network](https://segundo.world/network).
Everything runs on Monad testnet against Segundo's contract (deployed under its working name, Till):
`0xeb6c2c519c9bcc4495364c34ac116c20098113d1`.

## The question

Paying by the second means many tabs paying out at the same moment. A reviewer pointed out that every payout came from
one relayer address in nonce order and that we had no load test. So we measured three things on real tabs:

1. Many tabs paying out at once from many sender keys: how many land per second, how many fit in one block, and how
   long each takes to reach a block.
2. The same kind of payout from one key with its nonces pipelined (all sent at once).
3. The same kind of payout from one key, one at a time, waiting for each receipt: how Segundo's relayer
   (`web/lib/server.ts`) worked before this test.

## Method (run of October 13, 2026)

- **Setup** (`setup.mjs`): 16 fresh sender keys and 96 fresh freelancer keys, kept in `keys/bench.json` (gitignored,
  never printed). The keeper sent each key some test MON and the project's faucet wallet sent each sender 3 AUSD.
  Each sender approved the contract and opened 6 tabs with `open(payee, 0, rate, budget, memo)` straight to the
  contract (no forwarder): 96 tabs, ids 26 to 121, each 0.5 AUSD at 0.36 AUSD an hour (0.0001 AUSD a second, so a
  settle one second after the last always has something to pay). Every freelancer clocked in from its own key.
- **Gas**: Monad charges the gas limit, not the gas used, so every limit is `eth_estimateGas` plus a small margin.
  Measured: `open` 292,987; `clockIn` 38,438 to 50,186; `settle` 118,591 for a freelancer's first payout, 84,456
  after that (92,488 on 5 of the tabs), 31,564 when nothing new is owed.
- **Run A, many senders** (`burst.mjs`): every second for 5 seconds, each sender signs one `settle(id)` for each of
  its own 6 tabs with its own consecutive nonces and sends them in one JSON-RPC batch: 96 payouts a second, 480 in
  all. The Monad Foundation endpoint allows 50 calls a second per client, so senders are spread over three public
  endpoints (testnet-rpc.monad.xyz, monad-testnet.drpc.org, 10143.rpc.thirdweb.com).
- **Run B, one key pipelined**: a fresh key sends 48 settles with consecutive nonces in one batch.
- **Run C, one key one at a time**: the same key sends a settle, polls for its receipt every 150 ms, then sends the
  next, for 30 seconds.
- **Timing**: send time is this machine's clock just before the batch goes out. For A and B, "landed" is when the
  header of the block holding the transaction arrived over a WebSocket `newHeads` subscription; for C it is when
  the receipt came back. Block contents (all transactions, gas used) come from `eth_getBlockByNumber` afterwards,
  status and amounts from receipts and `Settled` events.
- **Block time**: the timestamp difference across the last 10,000 blocks, divided by 10,000.
- **Teardown** (`teardown.mjs`): every bench tab closed by its sender (the freelancer is paid what they earned, the
  rest goes back), all AUSD swept to the faucet wallet `0xa49d9f84FafA0FeBCBA2F02a3c0EEC75C8957534`, then all MON
  swept back to the keeper. Each MON sweep is the key's only transaction in its last few blocks, which Monad's
  reserve-balance rule needs for an account to empty itself, and is priced at exactly base fee + tip so no dust is
  left.

## Results

| | Many senders (A) | One key, pipelined (B) | One key, one at a time (C) |
|---|---|---|---|
| Payouts sent | 480 | 48 | 34 |
| Landed | 480 (461 succeeded, 19 reverted) | 48 (45 succeeded, 3 reverted) | 34 (33 succeeded, 1 reverted) |
| Time | 4.67 s from first send to last block | 0.91 s | 30.8 s |
| Per second | 102.8 | all 48 in one block | 1.1 |
| Most in one block | 96 (twice) | 48 | 1 |
| Send to block, median / 90th percentile | 0.92 s / 1.56 s | 0.91 s | 1.04 s / 1.05 s (to receipt) |

The burst spanned 14 blocks (70,681,931 to 70,681,944); the busiest used 8.1% of the block gas limit. Average block
time over the 10,000 blocks to 70,682,181 was 0.305 s. 402 of the 461 successful settles in run A moved money; the
other 59 landed in the same one-second timestamp as that tab's previous settle, so there was nothing new to pay.

**What it means.** One key is not the limit on Monad: 48 consecutive nonces from one key landed in one block. The
bottleneck was the relayer's send-and-wait loop (1.1 payouts a second, run C). A pool of relayer keys, each pipelining
its own nonces, is what production needs, and is what run A used.

**What changed since.** Segundo's relayer is now a pool of 7 keys (`web/lib/pool.ts`): `KEEPER_KEY` plus
`RELAYER_KEYS`. Each person's actions go to one key chosen from their address (a tab's payouts, from its id), so they
keep their order, and `sendAndWait` in `web/lib/server.ts` only serialises choosing the nonce and handing the
transaction to the node, so each key keeps many transactions in flight instead of waiting for each receipt.

**What it does not show.** Parallel execution: every settle changes the contract's AUSD balance (one storage slot),
so these transactions conflict and Monad's optimistic execution re-runs the later ones. The 23 reverts across the three
runs (19 in A, 3 in B, 1 in C) were all out of gas on the same 5 tabs, because we used one tight gas limit for every
tab to keep the cost down. Segundo's relayer estimates each call and adds 15%, and refuses a signed request asking for
more than 1.5 times its own estimate. Times are from one
machine through public endpoints.

**Cost.** About 11.7 test MON for the whole exercise (setup 3.9, the three runs 5.6, teardown about 2.2), all from
the project's own testnet wallets. Every leftover MON and AUSD was swept back.

## Re-running

From the repository root, with `web/.env.local` holding `KEEPER_KEY` and `FAUCET_KEY` (read in-process, never printed)
and `web/node_modules` installed (the scripts borrow its viem and ws):

```sh
node scripts/bench/setup.mjs senders=16 tabs=6   # keys, funding, approve, open, clock in (resumable)
node scripts/bench/burst.mjs waves=5 pipe=48 serial=30
node scripts/bench/report.mjs                    # newest run in scripts/bench/out -> web/public/bench.json
node scripts/bench/teardown.mjs                  # close tabs, sweep AUSD and MON back
node scripts/bench/check.mjs                     # balances of every bench key and the keeper's nonce
```

Budget first: at 102 gwei a settle costs about 0.0093 test MON and opening a tab about 0.032, and the keeper pays
for every user action on the live site, so keep it well funded. Delete `keys/bench.json` (after teardown) to start
over with fresh keys. The public addresses of this run's keys are in `web/lib/bench-addresses.ts`, so the site's stats
can leave them out.
