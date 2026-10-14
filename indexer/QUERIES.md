# Example queries

Run these against the indexer's GraphQL endpoint (the hosted deployment's URL, or http://localhost:8080/v1/graphql
under `pnpm dev`). Money is AUSD base units (6 decimals, so `1000000` is one dollar); times are unix seconds;
addresses are lower case.

## 1. Income statement for one address

Everything a freelancer has earned, who paid it, every payout, and what their clients paid in fees. The same
query works for a client: `paidOut`, `funded`, `refunded` and `tabsPaying` are their side.

```graphql
query IncomeStatement($address: String!) {
  Person_by_pk(id: $address) {
    id
    name
    place
    currency
    earned
    payoutsReceived
    clients
    shifts
    secondsWorked
    firstSeen
    paidOut
    funded
    refunded
    feesPaid
    feesRefunded
    tabsEarning(order_by: { openedAt: desc }) {
      id
      memo
      rate
      budget
      paid
      closed
      payer { id name place }
    }
    payouts(order_by: { timestamp: desc }, limit: 50) {
      amount
      timestamp
      tx
      tab { id memo }
      payer { id name }
      # The trusted CRE rate in force when this payout landed, and the amount at it (unset before the first report).
      currency
      rateE6
      rateAt
      localE6
    }
  }
  # Today's rate for the person's currency, posted on chain by Segundo's Chainlink CRE workflow.
  CurrencyRate(where: { id: { _eq: "PHP" } }) {
    id
    rateE6
    at
  }
}
```

Variables: `{ "address": "0x…" }` (lower case).

## 2. Daily stats for the last 30 days

```graphql
query Daily {
  DailyStat(order_by: { date: desc }, limit: 30) {
    id
    payouts
    paid
    fees
    feeCount
    refunds
    refundCount
    tabsOpened
    tabsClosed
    funded
    shifts
    secondsWorked
    activePeople
    newPeople
  }
}
```

## 3. Fee revenue, net of refunds

The running totals, then the most recent fees and refunds with the tab each one belongs to.

```graphql
query FeeRevenue {
  Totals_by_pk(id: "totals") {
    fees
    feeCount
    feeRefunds
    feeRefundCount
    netFees
    unlinkedInflow
    funded
    paid
    payouts
    tabsOpened
    people
    lastBlock
    lastTimestamp
  }
  Fee(where: { linked: { _eq: true } }, order_by: { timestamp: desc }, limit: 20) {
    amount
    timestamp
    tx
    payer { id name }
    tab { id }
    funding { kind amount }
  }
  FeeRefund(where: { kind: { _neq: "failed" } }, order_by: { timestamp: desc }, limit: 20) {
    kind
    amount
    timestamp
    tx
    to { id }
    tab { id refunded }
  }
}
```

## 4. Latest exchange rates from the CRE workflow

The current rate for every currency, the last few reports as posted, and the keeper's settlement runs.

```graphql
query Rates {
  CurrencyRate(order_by: { id: asc }) {
    id
    rateE6
    at
    updates
  }
  RateSnapshot(where: { trusted: { _eq: true } }, order_by: { at: desc }, limit: 5) {
    at
    currencies
    ratesE6
    from
    tx
  }
  KeeperRun(where: { trusted: { _eq: true } }, order_by: { timestamp: desc }, limit: 10) {
    tabs
    paid
    skipped
    timestamp
    tx
  }
  untrusted: RateSnapshot(where: { trusted: { _eq: false } }, order_by: { at: desc }, limit: 5) {
    from
    ratesE6
    tx
  }
}
```

Only reports sent by Segundo's CRE loop key or keeper key are `trusted`; anyone can call the testnet
MockKeystoneForwarder, so other senders' reports are kept, marked, and left out of `CurrencyRate` and the totals.

`rateE6` is units of the currency per 1 USD, times 1e6: `57250000` for PHP means 57.25 pesos to the dollar.
