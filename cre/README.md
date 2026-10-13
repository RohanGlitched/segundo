# Segundo keeper: a Chainlink CRE workflow

Segundo pays freelancers every second they are clocked in. The money is earned second by second on chain,
but it only moves to the freelancer's wallet when somebody calls `settle` on the tab. Segundo also shows
earnings in the currency people actually live on (pesos, naira, rupees, reais, shillings, euros).

This folder moves both jobs into a Chainlink Runtime Environment (CRE) workflow:

- **Keeper.** Each run reads Till on Monad testnet, finds the open tabs that owe their freelancer money, and
  settles them, all in one transaction.
- **Rate oracle.** In the same run it fetches USD exchange rates from three public sources and reduces them to
  one rate per currency (median per node, then median across nodes). The rates are written on chain with a
  timestamp, so an income statement can be converted at a rate anyone can check, not one the app picked.

The tabs live in Till, the contract deployed under Segundo's working name.

## How it runs today

This entry uses CRE's **simulation path**: the workflow is built with the CRE SDK and run with the CRE CLI's
simulator, `cre workflow simulate --broadcast`, which sends a real report on Monad testnet. It is **not deployed
to a live DON**; DON deployment isn't available to us on Monad testnet.

- **Schedule.** The workflow's own trigger is a cron of every 5 minutes (`schedule` in the config files). That
  cron only applies on a DON. The simulator runs the trigger once per call, so the reports on chain come from
  [`scripts/cre-loop.sh`](../scripts/cre-loop.sh) on an always-on server, which calls `simulate.sh --broadcast`
  every **2 hours** (`CRE_LOOP_EVERY=7200`).
- **Signer.** The loop signs with its own key, `0x022875424E1556FEC66Fdc5A7D52820dea4dBb8D`, used for nothing else.
  The first broadcasts were signed by the keeper key `0xe77f8062f66767428b1786709E079cABd01ABF40`.
- **Route.** That key's transaction goes to Chainlink's **MockKeystoneForwarder**, which calls
  `SegundoKeeper.onReport`.
- **Consensus.** The simulator runs a single node, so the "median across nodes" is that one node's median of
  the three sources.
- **What the mock forwarder doesn't check.** It verifies no DON signatures, and anyone can call it. On testnet,
  then, anyone could post rates to SegundoKeeper. The web app doesn't trust the contract's stored rates for that
  reason: it reads the `RatesPosted` logs and keeps only reports whose transaction was sent by one of Segundo's
  reporting keys (above; `CRE_REPORTERS` in `web/lib/cre.ts`) and whose report time is no more than 5 minutes
  ahead of its block. The newest such report is used while it is under 6 hours old; after that /api/fx falls
  back to the daily reference rate.
- **What a rogue report could still do.** Settling only ever pays freelancers what they have earned, so a
  report can't move money anywhere else. A report dated far in the future would make SegundoKeeper treat later
  real rates as stale. The app would then show reference rates after 6 hours, and fixing the contract needs a
  redeploy (see [Going to production](#going-to-production)).
- **On mainnet or a DON.** The workflow would run on a DON, and its reports would arrive through the real
  KeystoneForwarder, which verifies the DON's signatures. The owner would pin the workflow id and drop the
  mock forwarder.

## Contracts (Monad testnet, chain 10143)

| Contract | Address | Notes |
| --- | --- | --- |
| SegundoKeeper (this folder) | [`0xFEf8d6A7aF00ACd33FDdd2Ef8800cab78164d80D`](https://testnet.monadvision.com/address/0xFEf8d6A7aF00ACd33FDdd2Ef8800cab78164d80D) | Receives the workflow's reports. Verified on Sourcify, exact match ([job](https://sourcify-api-monad.blockvision.org/verify-ui/jobs/430e8de2-2f2a-4cbe-97fc-83604b0676a7)). Deploy tx [`0xcce52a96…`](https://testnet.monadscan.com/tx/0xcce52a962a1b0f471c4f5e3d1a2a54eacb1a35bc39930a6a62e20dd4409e7c38) |
| Till | [`0xeb6c2c519c9bcc4495364c34ac116c20098113d1`](https://testnet.monadvision.com/address/0xeb6c2c519c9bcc4495364c34ac116c20098113d1) | Unchanged. `settleMany` is open to anyone, and money only ever goes to the payee |
| CRE MockKeystoneForwarder | `0xB9F79d863261869B234c481D1f9A7af84AeAd192` | Delivers reports from `cre workflow simulate --broadcast` |
| CRE KeystoneForwarder | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | Delivers reports from a deployed workflow |

Both forwarder addresses come from the CRE [Forwarder Directory](https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts).
SegundoKeeper accepts reports only from these two forwarders. The mock forwarder relays a report from anyone,
though, so on testnet that allowlist alone doesn't stop someone else posting rates. The app's sender filter does
that job (see [How it runs today](#how-it-runs-today)).

## Verified on chain

`cre workflow simulate --broadcast` ran this workflow against Monad testnet on 13 October 2026. Full output: [SIMULATION.md](SIMULATION.md).

- **Transaction:** [`0x17d86a59…975d03`](https://testnet.monadscan.com/tx/0x17d86a590a0ed22bc60d941db6d0b0e462a449a6f7fe48a43704d97ebe975d03), block 70688328, success.
- **Second run, from the workflow's own key:** [`0x02b79463…ef1418`](https://testnet.monadscan.com/tx/0x02b79463789b20c0d609387ceb8789a1c7e446daa5c32871bf634e42d5ef1418), block 70700945: three tabs settled (11.98 AUSD) and six rates posted.
- **Since then** `scripts/cre-loop.sh` broadcasts a report every 2 hours from an always-on server. `GET https://segundo.world/api/cre` shows the count, the last trusted report's block and its rates. /send, /cashout and the income statements quote those on-chain rates, but only from trusted reports (see above).
- **Route:** keeper wallet → CRE MockKeystoneForwarder → `SegundoKeeper.onReport`. The forwarder's `ReportProcessed` result is `true`.
- **Rates:** `RatesPosted` with six rates (the simulator's median of three sources): PHP 62.770608, NGN 1331.514171, INR 95.78, BRL 4.989911, KES 129.717362 and EUR 0.89437 per USD.
- **Payments:** `Till.settleMany` paid three running tabs (2, 4 and 5) a total of 4.238888 AUSD. That shows as three `Settled` events and three AUSD transfers to the freelancers.
- **Before the broadcast:** a dry run read 127 tabs and built the same kind of report without sending it.

## What one run does

```
cron trigger (every 5 min on a DON; today one simulator run every 2 hours)
  │
  ├─ EVM read   Till.tabCount(), then Till.getTabs() over the newest 240 tabs in chunks of 40
  │             → open tabs owing at least 0.01 AUSD, largest first, at most maxSettle
  │               (12 in staging, 40 in production)
  │
  ├─ HTTP       each node fetches USD→PHP, NGN, INR, BRL, KES, EUR from
  │             open.er-api.com, fawazahmed0/currency-api (jsDelivr) and frankfurter.dev (ECB)
  │             → per node: median across sources; then median across nodes, per currency
  │               (the simulator is one node)
  │
  ├─ report     abi.encode(uint256[] ids, bytes3[] currencies, uint64[] ratesE6, uint64 at)
  │             on a DON, signed by the DON; `at` is the workflow's time
  │
  └─ EVM write  forwarder → SegundoKeeper.onReport   (MockKeystoneForwarder today)
                  → Till.settleMany(ids)        (pays every tab in the list)
                  → RatesPosted(at, currencies, ratesE6) and rateOf(currency) on chain
```

The receiver is written so one bad tab can't block the run: if `settleMany` reverts, it settles tab by tab
and logs any it skipped with `SettleSkipped(id)`. Rates from a report older than the last one are ignored,
as the IReceiver interface asks. Settling is still safe then, because it only pays what has been earned.

## Why CRE

- **A keeper that can leave our servers.** Before this, a bot holding one key settled tabs. The workflow is
  written so that a DON can run it. Today it is still one machine running the simulator (see
  [How it runs today](#how-it-runs-today)). Till's `settleMany` stays permissionless, so if the workflow stops,
  anyone can still settle.
- **Rates from several sources.** No single API sets the rate: each node takes the median of three sources, and
  on a DON the median across nodes follows. One failed or wrong source doesn't move the result.
- **On chain, with a time.** Each `RatesPosted` log carries the rates and the report time, and
  `SegundoKeeper.rateOf(bytes3("PHP"))` returns the latest. A freelancer's income statement can say
  "converted at the on-chain rate of block N", and anyone can check it. On testnet, check that the report's
  transaction came from the loop key, as the app does.

## Layout

```
cre/
  project.yaml               RPC for monad-testnet (both targets)
  simulate.sh                runs the simulator with the keeper key from ../web/.env.local (key never written or printed)
  segundo-keeper/            the workflow (TypeScript SDK)
    workflow.ts              trigger, reads, HTTP + consensus, report, write
    abi.ts                   Till views and the report layout
    workflow.test.ts         unit tests with the SDK's test runtime (EVM and HTTP mocks)
    config.staging.json      used by simulate (receiver = SegundoKeeper; gas limit 800,000, at most 12 tabs a run)
    config.production.json   for a deployed workflow (same addresses and sources; gas limit 1,500,000, at most 40 tabs)
    workflow.yaml
  contracts/                 Foundry project for the receiver
    src/SegundoKeeper.sol
    src/IReceiver.sol        from the CRE docs
    test/SegundoKeeper.t.sol
```

[`contracts/src`](../contracts/src) (Till) isn't touched: the deployed Till has an exact Sourcify match.

Both config files share the schedule (`0 */5 * * * *`), the Till and SegundoKeeper addresses, `minOwed`
(10,000 units, $0.01), `scanWindow` 240, `chunkSize` 40 and the three rate sources. Staging is tighter, with a gas
limit of 800,000 and `maxSettle` 12. Monad charges the gas limit, and the loop's key pays for every run.

## Run it

Everything below runs in WSL (Ubuntu). Requirements: [CRE CLI](https://docs.chain.link/cre/getting-started/cli-installation)
v1.30 or later (this was built with v1.38.0), Bun 1.2.21 or later, and Foundry.

```bash
# once
curl -sSL https://app.chain.link/cre/install.sh | bash
cre login
cd cre/segundo-keeper && bun install && cd ..

# workflow tests (no login needed)
cd segundo-keeper && bun test && bunx tsc --noEmit && cd ..

# simulate: dry run, then a real run that sends the report on Monad testnet
./simulate.sh
./simulate.sh --broadcast

# receiver tests
cd contracts && forge build && forge test
forge test --mt test_fork --fork-url https://testnet-rpc.monad.xyz   # against the live Till
```

`simulate.sh` signs with the workflow's own key (`keys/cre.json`, falling back to `KEEPER_KEY` from `web/.env.local`) and passes it to the CLI as `CRE_ETH_PRIVATE_KEY`, only
for that process. With `--broadcast` the keeper's test MON pays for gas, and the transaction goes to the mock
forwarder, which calls `SegundoKeeper.onReport`. The results are in [SIMULATION.md](SIMULATION.md).

Read the rates back:

```bash
cast call 0xFEf8d6A7aF00ACd33FDdd2Ef8800cab78164d80D "allRates()(bytes3[],uint64[],uint64[])" --rpc-url https://testnet-rpc.monad.xyz
```

Rates are units per 1 USD, times 10^6 (for example `62757000` means 62.757 PHP to the dollar).

## Going to production

Deploying needs CRE deploy access for the organization (request it with `cre account access`). Then set
`deployment-registry: "private"` (Chainlink-hosted, so no wallet or gas is needed for registry operations) under
`production-settings` in `segundo-keeper/workflow.yaml`, and run
`cre workflow deploy ./segundo-keeper --target production-settings`. SegundoKeeper
already accepts the Monad testnet KeystoneForwarder. After the first deploy, the owner should call
`setExpectedWorkflowId(id)`, so that only this workflow's reports are accepted. Leave it unset while
simulating, because the mock forwarder sends no workflow metadata. Then drop the mock forwarder with
`setForwarder(0xB9F7…D192, false)`.

The next SegundoKeeper should also refuse reports dated more than 5 minutes past `block.timestamp`, and give the
owner a way to reset `lastReportAt`. Without those, one far-future report through the mock forwarder freezes
the stored rates. The deployed contract is left as it is so its Sourcify match stands. Meanwhile the app ignores such a report, and if the rates freeze it falls back to the reference rate after 6 hours.
