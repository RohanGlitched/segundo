import type { Fee, Funding, Tab } from "envio";
import { type Books, FEE_MATCH_BLOCKS, type Mut, feeFor } from "./books";

/**
 * Pairing Segundo's 1% client fee with the open or top-up it paid for.
 *
 * The fee is its own AUSD transfer (an EIP-3009 authorisation the relayer submits next to the forwarded open),
 * so it lands in a different transaction: it used to follow the open and now goes just before it. A fee pairs
 * with a funding by the same client whose ceil(amount / 100) equals the fee, the nearest within FEE_MATCH_BLOCKS.
 * Whichever of the two arrives second makes the link. A transfer into the treasury that pairs with nothing is
 * not fee revenue (anyone can send AUSD to any address); it's kept as an unlinked inflow.
 */

const nearest = <T extends { block: number }>(rows: T[], block: number): T | undefined => {
  let best: T | undefined;
  let gap = Infinity;
  for (const r of rows) {
    const d = Math.abs(r.block - block);
    if (d <= FEE_MATCH_BLOCKS && d < gap) {
      best = r;
      gap = d;
    }
  }
  return best;
};

/** Counts a fee as revenue once it is linked: on the tab, the client, the totals and the day the fee was paid. */
async function link(books: Books, fee: Mut<Fee>, funding: Mut<Funding>, tab: Mut<Tab>): Promise<void> {
  fee.linked = true;
  fee.tab_id = tab.id;
  fee.funding_id = funding.id;
  fee.payer_id = funding.payer;
  funding.fee_id = fee.id;
  tab.feePaid += fee.amount;

  const client = await books.person(funding.payer, false);
  client.feesPaid += fee.amount;

  const t = books.totals;
  t.fees += fee.amount;
  t.feeCount += 1;
  t.netFees = t.fees - t.feeRefunds;
  t.unlinkedInflow -= fee.amount;

  const day = await books.dayFor(fee.timestamp);
  day.fees += fee.amount;
  day.feeCount += 1;
}

/** An open or top-up: records it and links a fee already paid for it, if one is waiting. */
export async function recordFunding(
  books: Books,
  tab: Mut<Tab>,
  kind: "open" | "topup",
  payer: string,
  amount: bigint,
  tx: string,
  logIndex: number,
): Promise<void> {
  const funding: Mut<Funding> = {
    id: `${tx}-${logIndex}`,
    tab_id: tab.id,
    payer,
    kind,
    amount,
    expectedFee: feeFor(amount),
    fee_id: undefined,
    block: books.block,
    timestamp: books.ts,
  };
  const waiting = (await books.context.Fee.getWhere({ from: { _eq: payer } })).filter(
    (f) => !f.linked && !f.refundedInFull && f.amount === funding.expectedFee,
  );
  const fee = nearest(waiting, books.block);
  if (fee) {
    const mutable = { ...fee };
    await link(books, mutable, funding, tab);
    books.context.Fee.set(mutable);
  }
  books.context.Funding.set(funding);
}

/** AUSD into the treasury: records it and links it to an open or top-up it paid for, if one is already indexed. */
export async function recordFee(books: Books, from: string, amount: bigint, tx: string, logIndex: number): Promise<void> {
  const { context } = books;
  const fee: Mut<Fee> = {
    id: `${tx}-${logIndex}`,
    payer_id: undefined,
    from,
    amount,
    linked: false,
    tab_id: undefined,
    funding_id: undefined,
    refundedInFull: false,
    timestamp: books.ts,
    block: books.block,
    day: books.day.id,
    tx,
  };
  books.totals.unlinkedInflow += amount;

  const open = (await context.Funding.getWhere({ payer: { _eq: from } })).filter(
    (f) => f.fee_id === undefined && f.expectedFee === amount,
  );
  const funding = nearest(open, books.block);
  if (funding) {
    const tab = { ...(await context.Tab.getOrThrow(funding.tab_id)) };
    const mutable = { ...funding };
    await link(books, fee, mutable, tab);
    context.Funding.set(mutable);
    context.Tab.set(tab);
  }
  context.Fee.set(fee);
}

/**
 * AUSD out of the treasury. In order of preference it is:
 * - "close": the refund owed on a closed tab (1% of the unspent budget, capped at the fees that tab paid);
 * - "failed": a whole fee sent back because the open or top-up it paid for failed (that fee was never revenue);
 * - "other": anything else to someone who has paid fees, counted as a fee refund;
 * otherwise it isn't a fee refund at all and only moves `otherOutflow`.
 */
export async function recordOutflow(books: Books, to: string, amount: bigint, tx: string, logIndex: number): Promise<void> {
  const { context } = books;
  const base = { id: `${tx}-${logIndex}`, toAddress: to, amount, timestamp: books.ts, block: books.block, day: books.day.id, tx };
  const t = books.totals;

  const due = (await context.RefundDue.getWhere({ payer: { _eq: to } }))
    .filter((d) => d.expected === amount)
    .sort((a, b) => b.closedBlock - a.closedBlock)[0];
  if (due) {
    const tab = { ...(await context.Tab.getOrThrow(due.tab_id)) };
    tab.feeRefunded += amount;
    context.Tab.set(tab);
    context.RefundDue.deleteUnsafe(due.id);
    await countRefund(books, to, amount);
    context.FeeRefund.set({ ...base, to_id: to, kind: "close", tab_id: tab.id, fee_id: undefined });
    return;
  }

  const unpaired = (await context.Fee.getWhere({ from: { _eq: to } })).filter(
    (f) => !f.linked && !f.refundedInFull && f.amount === amount && f.block <= books.block,
  );
  const failed = nearest(unpaired, books.block);
  if (failed) {
    context.Fee.set({ ...failed, refundedInFull: true });
    t.unlinkedInflow -= amount;
    await books.person(to, false);
    context.FeeRefund.set({ ...base, to_id: to, kind: "failed", tab_id: undefined, fee_id: failed.id });
    return;
  }

  const person = await context.Person.get(to);
  if (person && person.feesPaid > 0n) {
    await countRefund(books, to, amount);
    context.FeeRefund.set({ ...base, to_id: to, kind: "other", tab_id: undefined, fee_id: undefined });
    return;
  }

  t.otherOutflow += amount;
}

async function countRefund(books: Books, to: string, amount: bigint): Promise<void> {
  const client = await books.person(to, false);
  client.feesRefunded += amount;
  const t = books.totals;
  t.feeRefunds += amount;
  t.feeRefundCount += 1;
  t.netFees = t.fees - t.feeRefunds;
  books.day.refunds += amount;
  books.day.refundCount += 1;
}
