# Segundo indexer (Envio HyperIndex)

Segundo's on-chain ledger on Monad testnet, built with [Envio HyperIndex](https://docs.envio.dev) and read
through HyperSync. It turns every tab, payout, shift, client fee and fee refund into rows with running totals, and
serves them over GraphQL: a freelancer's income statement, the daily numbers on the business page, and fee
revenue net of refunds come from one query each instead of a scan of the chain.

The tab contract is deployed under Segundo's working name, Till.

## What it indexes

| Contract | Address | From block | Events |
| --- | --- | --- | --- |
| Till (tabs) | `0xeb6c2c519c9bcc4495364c34ac116c20098113d1` | 68119428 (deployment) | `Opened`, `Claimed`, `ClockedIn`, `ClockedOut`, `ToppedUp`, `Settled`, `Closed`, `Held`, `RateChanged`, `ProfileSet` |
| Agora AUSD | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` | 68119428 | `Transfer` where `to` or `from` is the treasury `0xAdF0F9443EafD19916cBd8f7541ea5e19e69F62c` |
| SegundoKeeper (Chainlink CRE receiver) | `0xFEf8d6A7aF00ACd33FDdd2Ef8800cab78164d80D` | 70682832 (deployment) | `RatesPosted`, `Kept`, `SettleSkipped` |

Chain: Monad testnet, chain id `10143` (HyperSync `https://monad-testnet.hypersync.xyz`).

The AUSD filter is an indexed-topic filter (`where: { params: [{ to: TREASURY }, { from: TREASURY }] }` in
`src/handlers/AUSD.ts`), so HyperSync only ever returns transfers that touch the treasury, never the rest of
AUSD's traffic.

## Entities

All money is AUSD base units (6 decimals) as `BigInt`; times are unix seconds; days are UTC `YYYY-MM-DD`;
addresses are lower case.

| Entity | One row per | Holds |
| --- | --- | --- |
| `Tab` | tab | payer, payee, rate, budget, top-ups, paid, refunded, open/closed/held/clocked in, shifts, seconds worked, fee paid, fee refunded |
| `Person` | address | profile (name, place, currency), earned, paid out, funded, refunded, fees paid and refunded, distinct clients and freelancers, first seen, last active |
| `Engagement` | client and freelancer pair | tabs between them, paid between them |
| `Payout` | `Settled` event | tab, payee, payer, amount, paid to date, time, tx |
| `Shift` | clock-in | start, end, seconds, earned (banked at clock-out minus banked at clock-in), rate, who stopped the clock |
| `Funding` | open or top-up | amount, expected fee, the fee that paid for it |
| `Fee` | AUSD transfer into the treasury | linked (paired with an open or top-up) or not, tab, refunded in full |
| `FeeRefund` | AUSD transfer out of the treasury to a fee payer | kind (`close`, `failed`, `other`), tab, fee |
| `RefundDue` | closed tab still owed a fee refund | expected amount; removed when the refund lands |
| `RateSnapshot` | CRE report's `RatesPosted` | currencies, rates (units per 1 USD times 1e6), report time, tx. Every report, whoever sent it (see below) |
| `CurrencyRate` | currency | latest on-chain rate, from any sender |
| `KeeperRun` | CRE report's `Kept` | tabs settled, AUSD paid, tabs skipped |
| `SkippedSettle` | `SettleSkipped` | tab the keeper couldn't pay in that run |
| `DailyStat` | UTC day | payouts, paid, fees, refunds, tabs opened/closed, funded, shifts, seconds worked, active and new people |
| `Totals` | one row, id `totals` | running totals of all of the above, plus `netFees` |

**CRE rates are unfiltered here.** On testnet, reports reach SegundoKeeper through Chainlink's MockKeystoneForwarder, which
anyone can call. This indexer records every `RatesPosted` and doesn't store the transaction sender, so `RateSnapshot` and
`CurrencyRate` can include rates someone else posted. Check a snapshot's `tx` sender against the CRE loop key
`0x022875424E1556FEC66Fdc5A7D52820dea4dBb8D` before trusting it. The web app does this itself in `web/lib/cre.ts` and
doesn't read rates from this indexer. Filtering here would mean adding `from` to `field_selection` and redeploying.

### How fees are counted

Segundo's fee is 1% of what a client funds, rounded up to the next AUSD unit, collected as its own EIP-3009
transfer next to the forwarded open or top-up (it used to follow the open; it now goes just before it). The
indexer pairs a transfer into the treasury with an open or top-up by the same client whose `ceil(amount / 100)`
equals it, the nearest within 600 blocks, whichever of the two is indexed second. Only paired transfers count as
fee revenue (`Totals.fees`); anything else sent to the treasury is `Totals.unlinkedInflow`.

Out of the treasury: a transfer matching a closed tab's expected refund (`min(refunded / 100, fees paid on the
tab)`) is a `close` refund on that tab; a transfer that returns a whole unpaired fee is a `failed` refund (it
nets out of `unlinkedInflow`, since that fee was never revenue); any other transfer to someone who has paid fees
is an `other` refund. `Totals.netFees = fees - feeRefunds`. These rules match `web/lib/envio.ts` and
`web/lib/refund.ts`.

## Run it

Node 22.15 or newer and pnpm.

```bash
cd indexer
pnpm install
pnpm codegen      # generates types from config.yaml and schema.graphql
pnpm typecheck
pnpm test         # handler tests on simulated events: no network, no database, no Docker
pnpm dev          # local indexer with Postgres and Hasura (needs Docker and ENVIO_API_TOKEN for HyperSync)
```

`pnpm dev` serves GraphQL at http://localhost:8080 (local admin password `testing`). Copy `.env.example` to `.env`
and set `ENVIO_API_TOKEN` (an Envio API token with HyperSync access, from https://envio.dev/app/api-tokens).

## Hosted deployment (Envio hosted service)

The indexer lives in the `indexer/` folder of https://github.com/RohanGlitched/segundo. In the Envio app
(https://envio.dev/app), sign in with GitHub, install the Envio Deployments GitHub App on
`RohanGlitched/segundo`, choose the repo and click **Add Indexer**, then:

| Setting | Value |
| --- | --- |
| Indexer name | `segundo` |
| Root Directory | `indexer` |
| Config File Path | `config.yaml` (relative to the root directory) |
| Deployment Branch | `main` |
| Environment variables | none needed |

Every push to `main` deploys a new version that indexes from block 68119428; the previous version keeps serving
until the new one has synced. The deployment page shows the GraphQL endpoint (of the form
`https://indexer.dev.hyperindex.xyz/<id>/v1/graphql`). Example queries are in [QUERIES.md](./QUERIES.md).

The whole history to date is about 2,700 events (well inside the development plan's 100,000-event limit).
