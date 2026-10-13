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

/** The payout policy for mainnet: on screen, off screen, and the cap on gas as a share of a tab's fee. */
export const POLICY = {
  /** A tab someone has open is paid this often, batched with every other open tab. */
  onScreenS: 10,
  /** Every other running tab is paid by the keeper this often, in one settleMany (as the testnet keeper already does). */
  offScreenS: 300,
  /** The relayer slows a tab's on-screen payouts rather than spend more than this share of its fee on gas. */
  gasCap: 0.5,
};

/** The prices the site prices gas at: 102 gwei on every relayer receipt, and our MON assumption. */
export const PRICES = { gasGwei: 102, monPrice: 0.05 };

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
};

export const DEFAULTS: Inputs = {
  people: 150,
  hours: EXAMPLE.hours,
  rate: EXAMPLE.rate,
  days: 10,
  yieldPct: 1,
  feePct: EXAMPLE.feePct,
  onScreen: 0.25,
  onScreenEvery: POLICY.onScreenS,
  offScreenEvery: POLICY.offScreenS,
  batched: true,
  monPrice: PRICES.monPrice,
  gasGwei: PRICES.gasGwei,
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
  const perPayout = (batch: number) => (i.batched ? BATCH_EXTRA + (BATCH_FIRST - BATCH_EXTRA) / Math.max(1, batch) : GAS.settle);
  const onGas = perPayout(clockedNow * i.onScreen);
  const offGas = perPayout(clockedNow * (1 - i.onScreen));

  // The cap: on screen, never pay out faster than half the fee covers.
  const feePerSecond = (i.rate * feeRate) / 3600;
  const capEvery = feePerSecond > 0 ? gasUsd(onGas, i.gasGwei, i.monPrice) / (POLICY.gasCap * feePerSecond) : Infinity;
  const onEvery = Math.max(i.onScreenEvery, capEvery);
  const capped = capEvery > i.onScreenEvery;

  const payoutsHour = i.onScreen * (3600 / onEvery) + (1 - i.onScreen) * (3600 / i.offScreenEvery);
  const payoutGasHour = i.onScreen * (3600 / onEvery) * onGas + (1 - i.onScreen) * (3600 / i.offScreenEvery) * offGas;

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
  const net = fee + float - gasAll;
  return {
    hoursMonth,
    volume,
    fee,
    float,
    gasAll,
    net,
    feeFreelancer,
    netFreelancer: net / Math.max(1, i.people),
    gasTabHour: gasUsdMonth / hoursMonth,
    monTabHour: monMonth / hoursMonth,
    feeTabHour: feeRate * i.rate,
    /** Gas as a share of the fee, and the gross margin it leaves on the fee alone. */
    gasShare: fee > 0 ? gasAll / fee : Infinity,
    payoutsHour,
    onGas,
    offGas,
    onEvery,
    capped,
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
