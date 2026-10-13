# Segundo keeper: a Chainlink CRE workflow

Segundo pays freelancers every second they are clocked in. The money is earned second by second on chain,
but it only moves to the freelancer's wallet when somebody calls `settle` on the tab. Segundo also shows
earnings in the currency people actually live on (pesos, naira, rupees, reais, shillings, euros).

This folder moves both jobs into a Chainlink Runtime Environment (CRE) workflow:

- **Keeper.** Every 5 minutes the workflow reads Till on Monad testnet, finds the open tabs that owe their
  freelancer money, and settles them, all in one transaction.
- **Rate oracle.** In the same run it fetches USD exchange rates from three public sources, and the DON
  agrees on one rate per currency. The rates are written on chain with a timestamp, so an income statement
  can be converted at a rate anyone can check, not one the app picked.

The tabs live in Till, the contract deployed under Segundo's working name.

## Contracts (Monad testnet, chain 10143)

| Contract | Address | Notes |
| --- | --- | --- |
| SegundoKeeper (this folder) | [`0xFEf8d6A7aF00ACd33FDdd2Ef8800cab78164d80D`](https://testnet.monadvision.com/address/0xFEf8d6A7aF00ACd33FDdd2Ef8800cab78164d80D) | Receives the workflow's reports. Verified on Sourcify, exact match ([job](https://sourcify-api-monad.blockvision.org/verify-ui/jobs/430e8de2-2f2a-4cbe-97fc-83604b0676a7)). Deploy tx [`0xcce52a96…`](https://testnet.monadscan.com/tx/0xcce52a962a1b0f471c4f5e3d1a2a54eacb1a35bc39930a6a62e20dd4409e7c38) |
| Till | [`0xeb6c2c519c9bcc4495364c34ac116c20098113d1`](https://testnet.monadvision.com/address/0xeb6c2c519c9bcc4495364c34ac116c20098113d1) | Unchanged. `settleMany` is open to anyone, and money only ever goes to the payee |
| CRE MockKeystoneForwarder | `0xB9F79d863261869B234c481D1f9A7af84AeAd192` | Delivers reports from `cre workflow simulate --broadcast` |
| CRE KeystoneForwarder | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | Delivers reports from a deployed workflow |

Both forwarder addresses come from the CRE [Forwarder Directory](https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts).
SegundoKeeper accepts reports only from them, so nobody else can post rates.

## Verified on chain

`cre workflow simulate --broadcast` ran this workflow against Monad testnet on 13 October 2026. Full output: [SIMULATION.md](SIMULATION.md).

- **Transaction:** [`0x17d86a59…975d03`](https://testnet.monadscan.com/tx/0x17d86a590a0ed22bc60d941db6d0b0e462a449a6f7fe48a43704d97ebe975d03), block 70688328, success.
- **Route:** keeper wallet → CRE MockKeystoneForwarder → `SegundoKeeper.onReport`. The forwarder's `ReportProcessed` result is `true`.
- **Rates:** `RatesPosted` with six rates the DON agreed on: PHP 62.770608, NGN 1331.514171, INR 95.78, BRL 4.989911, KES 129.717362 and EUR 0.89437 per USD.
- **Payments:** `Till.settleMany` paid three running tabs (2, 4 and 5) a total of 4.238888 AUSD. That shows as three `Settled` events and three AUSD transfers to the freelancers.
- **Before the broadcast:** a dry run read 127 tabs and built the same kind of report without sending it.

## What one run does

```
cron (every 5 min)
  │
  ├─ EVM read   Till.tabCount(), then Till.getTabs() over the newest 240 tabs in chunks of 40
  │             → open tabs owing at least 0.01 AUSD, largest first, at most 40
  │
  ├─ HTTP       each node fetches USD→PHP, NGN, INR, BRL, KES, EUR from
  │             open.er-api.com, fawazahmed0/currency-api (jsDelivr) and frankfurter.dev (ECB)
  │             → per node: median across sources; DON: median across nodes, per currency
  │
  ├─ report     abi.encode(uint256[] ids, bytes3[] currencies, uint64[] ratesE6, uint64 at)
  │             signed by the DON, `at` is DON time
  │
  └─ EVM write  forwarder → SegundoKeeper.onReport
                  → Till.settleMany(ids)        (pays every tab in the list)
                  → RatesPosted(at, currencies, ratesE6) and rateOf(currency) on chain
```

The receiver is written so one bad tab can't block the run: if `settleMany` reverts, it settles tab by tab
and logs any it skipped with `SettleSkipped(id)`. Rates from a report older than the last one are ignored,
as the IReceiver interface asks. Settling is still safe then, because it only pays what has been earned.

## Why CRE

- **No single keeper.** Before this, a bot holding one key settled tabs. Now a DON triggers the runs, and
  Till's `settleMany` stays permissionless. If the workflow stops, anyone can still settle.
- **Rates the nodes agree on.** No single API, and no single node, sets the rate. Each node takes the median of
  three sources, and the DON takes the median of the nodes. One failed or wrong source doesn't move the result.
- **On chain, with a time.** `SegundoKeeper.rateOf(bytes3("PHP"))` returns the rate and the DON time it was
  agreed. A freelancer's income statement can say "converted at the on-chain rate of block N", and anyone can
  check it.

## Layout

```
cre/
  project.yaml               RPC for monad-testnet (both targets)
  simulate.sh                runs the simulator with the keeper key from ../web/.env.local (key never written or printed)
  segundo-keeper/            the workflow (TypeScript SDK)
    workflow.ts              trigger, reads, HTTP + consensus, report, write
    abi.ts                   Till views and the report layout
    workflow.test.ts         unit tests with the SDK's test runtime (EVM and HTTP mocks)
    config.staging.json      used by simulate (receiver = SegundoKeeper)
    config.production.json   same values, for a deployed workflow
    workflow.yaml
  contracts/                 Foundry project for the receiver
    src/SegundoKeeper.sol
    src/IReceiver.sol        from the CRE docs
    test/SegundoKeeper.t.sol
```

`till/contracts/src` isn't touched: the deployed Till has an exact Sourcify match.

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

`simulate.sh` reads `KEEPER_KEY` from `web/.env.local` and passes it to the CLI as `CRE_ETH_PRIVATE_KEY`, only
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
simulating, because the mock forwarder sends no workflow metadata.
