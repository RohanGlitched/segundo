# Simulation results

Both runs used `cre workflow simulate` (CRE CLI v1.38.0, `@chainlink/cre-sdk` 1.23.0) against Monad testnet
(chain 10143), on 13 October 2026, through [`simulate.sh`](simulate.sh). The keeper wallet
`0xe77f8062f66767428b1786709E079cABd01ABF40` signed and paid gas for the broadcast run.

The simulator's log timestamps come from the local machine clock (UTC+8) even though they are marked `Z`.
The on-chain times below are UTC.

## 1. Dry run: `./simulate.sh`

The workflow read Till, fetched rates and built the report. Nothing was sent, so the transaction hash is all zeros.

```
2026-10-13T21:00:50Z [SIMULATION] Running trigger trigger=cron-trigger@1.0.0
2026-10-13T21:00:52Z [USER LOG] Till has 127 tabs; scanned 127, 4 running, 3 owe at least 0.010000 AUSD (3.032500 AUSD in all)
2026-10-13T21:00:56Z [USER LOG] USD rates (median of 3 sources): PHP 62.786942, NGN 1329.766882, INR 95.780000, BRL 4.989911, KES 129.714157, EUR 0.894845
2026-10-13T21:00:56Z [USER LOG] Report delivered to SegundoKeeper 0xFEf8d6A7aF00ACd33FDdd2Ef8800cab78164d80D: 0x0000000000000000000000000000000000000000000000000000000000000000

✓ Workflow Simulation Result:
"Settled 3 tabs (3.032500 AUSD owed), posted 6 rates; tx 0x0000000000000000000000000000000000000000000000000000000000000000"
```

## 2. Broadcast run: `./simulate.sh --broadcast`

```
Compiling workflow...
✓ Workflow compiled
✓ Simulation limits enabled
  Binary hash: eb1bc81ef3555c396a253d143eaa8b357b34fc33db08b7d4214a7339d95fbf8c
  Config hash: a7df557f7c54bafa347954659624d4ac5032edb96682afcad4f42da78fcc7d8d
2026-10-13T21:01:29Z [SIMULATION] Simulator Initialized

2026-10-13T21:01:29Z [SIMULATION] Running trigger trigger=cron-trigger@1.0.0
2026-10-13T21:01:31Z [USER LOG] Till has 127 tabs; scanned 127, 4 running, 3 owe at least 0.010000 AUSD (4.126667 AUSD in all)
2026-10-13T21:01:31Z [USER LOG] USD rates (median of 3 sources): PHP 62.770608, NGN 1331.514171, INR 95.780000, BRL 4.989911, KES 129.717362, EUR 0.894370
2026-10-13T21:01:34Z [USER LOG] Report delivered to SegundoKeeper 0xFEf8d6A7aF00ACd33FDdd2Ef8800cab78164d80D: 0x17d86a590a0ed22bc60d941db6d0b0e462a449a6f7fe48a43704d97ebe975d03
2026-10-13T21:01:34Z [USER LOG] https://testnet.monadscan.com/tx/0x17d86a590a0ed22bc60d941db6d0b0e462a449a6f7fe48a43704d97ebe975d03

✓ Workflow Simulation Result:
"Settled 3 tabs (4.126667 AUSD owed), posted 6 rates; tx 0x17d86a590a0ed22bc60d941db6d0b0e462a449a6f7fe48a43704d97ebe975d03"

2026-10-13T21:01:34Z [SIMULATION] Execution finished signal received
```

### On chain

Transaction [`0x17d86a590a0ed22bc60d941db6d0b0e462a449a6f7fe48a43704d97ebe975d03`](https://testnet.monadscan.com/tx/0x17d86a590a0ed22bc60d941db6d0b0e462a449a6f7fe48a43704d97ebe975d03)
landed in block **70688328** at 13:01:33 UTC with status **success**. It went from the keeper wallet to the CRE
MockKeystoneForwarder `0xB9F79d863261869B234c481D1f9A7af84AeAd192`, which called `SegundoKeeper.onReport`.

The transaction emitted these events, in order:

| Contract | Event | Decoded |
| --- | --- | --- |
| SegundoKeeper | `RatesPosted` | at 1791896491 (DON time, 13:01:31 UTC), the six rates below |
| Till | `Activity`, `Settled` + AUSD `Transfer` | tab **4** → `0x8340…4d97`: 1.708333 AUSD |
| Till | `Activity`, `Settled` + AUSD `Transfer` | tab **5** → `0x0117…09a9`: 1.480555 AUSD |
| Till | `Activity`, `Settled` + AUSD `Transfer` | tab **2** → `0x9298…4be0`: 1.050000 AUSD |
| SegundoKeeper | `Kept` | 3 tabs, **4.238888 AUSD** paid |
| MockKeystoneForwarder | `ReportProcessed` | receiver SegundoKeeper, result `true` |

Each payment is a little more than the amount the workflow logged as owed. The tabs were running, so a few more
seconds of work had been earned by the time the report landed.

The rates stored on SegundoKeeper, read back with `allRates()`. Each value is units per 1 USD, times 10^6:

| Currency | `ratesE6` | Rate |
| --- | --- | --- |
| PHP | 62770608 | 62.770608 |
| NGN | 1331514171 | 1331.514171 |
| INR | 95780000 | 95.780000 |
| BRL | 4989911 | 4.989911 |
| KES | 129717362 | 129.717362 |
| EUR | 894370 | 0.894370 |

The contract state after this run: `reports() = 1`, `totalPaid() = 4238888` and `lastReportAt() = 1791896491`.

Check it yourself:

```bash
cast call 0xFEf8d6A7aF00ACd33FDdd2Ef8800cab78164d80D "allRates()(bytes3[],uint64[],uint64[])" --rpc-url https://testnet-rpc.monad.xyz
cast receipt 0x17d86a590a0ed22bc60d941db6d0b0e462a449a6f7fe48a43704d97ebe975d03 --rpc-url https://testnet-rpc.monad.xyz
```

### Where the rates came from

Each node fetched open.er-api.com, fawazahmed0/currency-api (via jsDelivr) and frankfurter.dev (ECB data).
It took the median of the sources for each currency. ECB data has no NGN or KES, so those two are the middle of
two sources. Then the DON took the median across nodes. The simulator runs a single node, so this run's DON
median is that one node's value. A deployed workflow takes the median across the whole DON.

## Tenant check

After `cre login`, `cre workflow supported-chains` lists `monad-testnet` (chain selector 2183018362218727504).
Its forwarder is `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` and its mock forwarder is
`0xB9F79d863261869B234c481D1f9A7af84AeAd192`. SegundoKeeper accepts both.
