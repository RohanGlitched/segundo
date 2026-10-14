/**
 * Unit economics in one place, shared by the /business calculator, the deck and /network, so every page prices
 * gas from the same receipts and states the same payout policy. Plain module (no "use client"), so server
 * components can import the numbers too.
 */

/**
 * Gas per action, averaged over Segundo's relayer receipts on Monad testnet (relayer 0xe77f…ABF40), read on
 * October 13, 2026. Monad charges the gas limit, and the relayer sets the limit at eth_estimateGas plus 15%, so
 * these are what the relayer actually paid: a payout's estimate is 84,456 (see /network), its receipts 97,673.
 */
export const GAS = {
  /** settle(id) on one tab: 277 transactions. */
  settle: 97_673,
  /** openWithPermit through the forwarder: 5 transactions. */
  open: 512_162,
  /** topUpWithPermit through the forwarder: 48 transactions. */
  topUp: 261_664,
  /** The 1% fee, an AUSD transferWithAuthorization: 6 transactions. Fee refunds are the same call. */
  fee: 113_517,
  /** clockIn through the forwarder: 21 transactions. */
  clockIn: 123_712,
  /** clockOut through the forwarder: 17 transactions. */
  clockOut: 124_872,
  /** close through the forwarder: 1 transaction. */
  close: 180_670,
};

/**
 * Each extra tab in one settleMany. eth_estimateGas on Monad testnet, October 13, 2026: settleMany over one running
 * tab 84,609, over two 117,849, so 33,240 more; with the relayer's 15% margin 38,226, rounded up.
 */
export const BATCH_EXTRA = 40_000;
/** The first tab in a batch costs what a single settle does. */
export const BATCH_FIRST = GAS.settle;
/**
 * Our own ceiling on one settleMany, well under what a Monad transaction may use: about 248 tabs a transaction.
 * A bigger batch is split into transactions of this size, each paying the first-tab cost again.
 */
export const BATCH_TX_GAS = 10_000_000;
export const TABS_PER_BATCH_TX = Math.floor((BATCH_TX_GAS - BATCH_FIRST) / BATCH_EXTRA) + 1;
/** Block gas limit on Monad testnet (every block of our load test) and the block time we measured over 10,000 blocks. */
export const BLOCK_GAS = 150_000_000;
export const BLOCK_S = 0.305;

/** The payout policy for mainnet: on screen, off screen, and the cap on gas as a share of a tab's fee. */
export const POLICY = {
  /** A tab someone has open is paid this often, batched with every other open tab. */
  onScreenS: 10,
  /** Every other running tab is paid by the keeper this often, in one settleMany (as the testnet keeper already does). */
  offScreenS: 300,
  /** The relayer slows a tab's payouts, on screen and off, rather than spend more than this share of its fee on payout gas. */
  gasCap: 0.5,
};

/**
 * How often a tab is paid out on testnet today, so every page says the same thing: the tab page asks for a payout
 * every 6 s for its first two minutes open, then every 20 s, then once a minute after ten minutes
 * (app/tab/[id]/page.tsx), and the keeper pays running tabs every 5 minutes (bots/till-bots.mjs).
 */
export const TESTNET_PACE = { firstS: 6, firstForS: 120, thenS: 20, laterS: 60, laterAfterS: 600, keeperS: 300 };

/** The prices the site prices gas at: 102 gwei on every relayer receipt, and our MON assumption. */
export const PRICES = { gasGwei: 102, monPrice: 0.05 };

/** The raise, in one line, the same on /business and the deck. */
export const ASK =
  "Raising a $500k pre-seed for 12 months: audit and mainnet, cash-out partners in Manila and Lagos, an EU/US on-ramp, and 10 design-partner studios.";

/** The example freelancer used across the site: 35 hours a week at $20 an hour. */
export const EXAMPLE = { hours: 35, rate: 20, feePct: 1 };

export const WEEKS_A_MONTH = 52 / 12;
/** Hours per clock-in, our assumption: each shift costs one clock-in and one clock-out. */
export const SHIFT_HOURS = 4;

/** Dollars of gas for `gas` units at these prices. */
export const gasUsd = (gas: number, gasGwei = PRICES.gasGwei, monPrice = PRICES.monPrice) => gas * gasGwei * 1e-9 * monPrice;

/**
 * The fastest payout pace the fee alone pays for, in seconds between payouts: the point where one payout's gas
 * equals the fee earned in between. Clock-ins, opens and closes are left out (they are well under 1% of the fee).
 */
export function breakEvenEvery(gasPerPayout: number, rate = EXAMPLE.rate, feePct = EXAMPLE.feePct, gasGwei = PRICES.gasGwei, monPrice = PRICES.monPrice) {
  const feePerSecond = (rate * feePct) / 100 / 3600;
  return feePerSecond > 0 ? gasUsd(gasPerPayout, gasGwei, monPrice) / feePerSecond : Infinity;
}

/** A client's fee for one freelancer-month at these hours. */
export const feePerMonth = (hours = EXAMPLE.hours, rate = EXAMPLE.rate, feePct = EXAMPLE.feePct) => hours * WEEKS_A_MONTH * rate * (feePct / 100);

export type Inputs = {
  people: number;
  hours: number;
  rate: number;
  days: number;
  yieldPct: number;
  feePct: number;
  /** Share of clocked-in hours someone has the tab open, 0 to 1. */
  onScreen: number;
  onScreenEvery: number;
  offScreenEvery: number;
  batched: boolean;
  monPrice: number;
  gasGwei: number;
  /** Other variable costs per freelancer-month in dollars (KYC, sanctions screening, wallet and infra), our assumption. */
  otherUsd: number;
};

export const DEFAULTS: Inputs = {
  people: 150,
  hours: EXAMPLE.hours,
  rate: EXAMPLE.rate,
  // A weekly budget spent evenly over the week waits about 3.5 days on average; the gas model below assumes weekly budgets.
  days: 4,
  yieldPct: 1,
  feePct: EXAMPLE.feePct,
  onScreen: 0.25,
  onScreenEvery: POLICY.onScreenS,
  offScreenEvery: POLICY.offScreenS,
  batched: true,
  monPrice: PRICES.monPrice,
  gasGwei: PRICES.gasGwei,
  otherUsd: 2,
};

/**
 * One month at a given size: the client fee, the float, and what the relayer spends on gas to keep both sides
 * gasless under the payout policy. Batches are as big as the tabs being paid at the same moment, with hours spread
 * evenly over the week (a conservative guess: real work bunches into working hours, which makes batches bigger).
 */
export function unitEconomics(i: Inputs) {
  const hoursMonth = i.hours * WEEKS_A_MONTH;
  const volume = i.people * hoursMonth * i.rate;
  const feeRate = i.feePct / 100;
  const fee = volume * feeRate;
  // The average balance waiting in escrow is a day's volume times the days it waits; yield accrues on that balance.
  const float = ((volume * 12) / 365) * i.days * (i.yieldPct / 100 / 12);

  const clockedNow = i.people * (i.hours / 168);
  // A batch bigger than one transaction's share is split, and each transaction pays the first-tab cost again.
  const perPayout = (batch: number) => {
    if (!i.batched) return GAS.settle;
    const tabs = Math.max(1, batch);
    return BATCH_EXTRA + ((BATCH_FIRST - BATCH_EXTRA) * Math.ceil(tabs / TABS_PER_BATCH_TX)) / tabs;
  };
  const onGas = perPayout(clockedNow * i.onScreen);
  const offGas = perPayout(clockedNow * (1 - i.onScreen));

  // The cap, on screen and off: never pay out faster than half the fee covers. With no fee there is nothing to
  // weigh gas against, so only the keeper's schedule runs.
  const feePerSecond = (i.rate * feeRate) / 3600;
  const noFee = feePerSecond <= 0;
  const capFor = (gas: number) => (noFee ? 0 : gasUsd(gas, i.gasGwei, i.monPrice) / (POLICY.gasCap * feePerSecond));
  const onEvery = noFee ? Infinity : Math.max(i.onScreenEvery, capFor(onGas));
  const offEvery = Math.max(i.offScreenEvery, capFor(offGas));
  const capped = !noFee && capFor(onGas) > i.onScreenEvery;
  const offCapped = !noFee && capFor(offGas) > i.offScreenEvery;

  const payoutsHour = i.onScreen * (3600 / onEvery) + (1 - i.onScreen) * (3600 / offEvery);
  const payoutGasHour = i.onScreen * (3600 / onEvery) * onGas + (1 - i.onScreen) * (3600 / offEvery) * offGas;
  // Payout gas across every tab clocked in at once, against what Monad's blocks hold in a second.
  const payoutGasSecond = (clockedNow * payoutGasHour) / 3600;
  const blockspace = payoutGasSecond / (BLOCK_GAS / BLOCK_S);
  const tabsPerBatch = clockedNow * i.onScreen;

  // A clock-in and out per shift, and a weekly budget (one open, then a top-up each week, each with its fee
  // transfer), closed once with its fee refund.
  const fixedGas =
    (hoursMonth / SHIFT_HOURS) * (GAS.clockIn + GAS.clockOut) + GAS.open + (WEEKS_A_MONTH - 1) * GAS.topUp + WEEKS_A_MONTH * GAS.fee + GAS.close + GAS.fee;
  const gasMonth = payoutGasHour * hoursMonth + fixedGas;
  const monPerGas = i.gasGwei * 1e-9;
  const monMonth = gasMonth * monPerGas;
  const gasUsdMonth = monMonth * i.monPrice;
  const gasAll = gasUsdMonth * i.people;

  const feeFreelancer = fee / Math.max(1, i.people);
  /** Contribution after gas: the fee and the yield share, less the relayer's gas. */
  const net = fee + float - gasAll;
  const otherAll = i.otherUsd * i.people;
  const left = net - otherAll;
  return {
    hoursMonth,
    volume,
    fee,
    float,
    gasAll,
    net,
    otherAll,
    left,
    feeFreelancer,
    netFreelancer: net / Math.max(1, i.people),
    leftFreelancer: left / Math.max(1, i.people),
    gasTabHour: gasUsdMonth / hoursMonth,
    monTabHour: monMonth / hoursMonth,
    feeTabHour: feeRate * i.rate,
    /** Gas as a share of the fee, and the gross margin it leaves on the fee alone. */
    gasShare: fee > 0 ? gasAll / fee : Infinity,
    payoutsHour,
    onGas,
    offGas,
    onEvery,
    offEvery,
    capped,
    offCapped,
    noFee,
    /** Share of Monad's block gas, per second, that these payouts would use. */
    blockspace,
    /** Tabs on screen at one moment, so in one batch, and how many transactions that batch needs. */
    tabsPerBatch,
    batchTxs: i.batched ? Math.max(1, Math.ceil(tabsPerBatch / TABS_PER_BATCH_TX)) : 0,
    /** The MON price at which gas eats the whole fee. */
    breakEvenMon: monMonth > 0 ? feeFreelancer / monMonth : Infinity,
    /** Seconds between payouts the fee pays for, one payout per transaction and batched. */
    breakEvenSingle: breakEvenEvery(GAS.settle, i.rate, i.feePct, i.gasGwei, i.monPrice),
    breakEvenBatched: breakEvenEvery(BATCH_EXTRA, i.rate, i.feePct, i.gasGwei, i.monPrice),
  };
}

/** The defaults, worked once, for pages that quote them. */
export const AT_DEFAULTS = unitEconomics(DEFAULTS);

type BenchBlock = { number: number; ours: number; gasUsed: number; gasLimit: number };

/**
 * Gas headroom from the load test: the block that held the most of our payouts, how full it was, and how many
 * payouts the same block would hold at that rate (rounded down to the hundred). This is gas room, not a claim
 * about parallel execution: every settle still writes the same AUSD balance slot.
 */
export function headroom(perBlock: BenchBlock[], blockMs: number) {
  const most = Math.max(...perBlock.map((b) => b.ours));
  const block = perBlock.filter((b) => b.ours === most).sort((a, b) => b.gasUsed - a.gasUsed)[0]!;
  const share = block.gasUsed / block.gasLimit;
  const perBlockRoom = Math.floor(most / share / 100) * 100;
  return {
    payouts: most,
    block: block.number,
    pct: Math.round(share * 1000) / 10,
    perBlock: perBlockRoom,
    perSecond: Math.floor(perBlockRoom / (blockMs / 1000) / 100) * 100,
  };
}
