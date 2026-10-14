import { indexer, type Engagement, type Shift, type Tab } from "envio";
import { Books, type Mut, ZERO_ADDRESS, currencyCode, eventId, feeFor, min, tabOf } from "../lib/books";
import { recordFunding } from "../lib/fees";

/**
 * Till: the tab contract (deployed under Segundo's working name). Every handler keeps the tab, the people on it,
 * the day and the running totals in step.
 */

/** A freelancer joins a tab: counts the tab for them, and a first tab between this client and freelancer. */
async function engage(books: Books, tab: Mut<Tab>, payee: string, active: boolean): Promise<void> {
  const client = await books.person(tab.payer_id, false);
  const freelancer = await books.person(payee, active);
  tab.payee_id = freelancer.id;
  freelancer.tabsAsFreelancer += 1;
  if (freelancer.tabsAsFreelancer === 1) books.totals.freelancers += 1;

  const id = `${client.id}-${freelancer.id}`;
  const known = await books.context.Engagement.get(id);
  const pair: Mut<Engagement> = known
    ? { ...known, tabs: known.tabs + 1 }
    : { id, payer_id: client.id, payee_id: freelancer.id, tabs: 1, paid: 0n, firstAt: books.ts };
  if (!known) {
    client.freelancers += 1;
    freelancer.clients += 1;
  }
  books.context.Engagement.set(pair);
}

indexer.onEvent({ contract: "Till", event: "Opened" }, async ({ event, context }) => {
  const { id, payer, payee, rate, budget, invite, memo } = event.params;
  const books = await Books.open(context, event.block.timestamp, event.block.number);
  const client = await books.person(payer);
  client.tabsAsClient += 1;
  client.funded += budget;
  if (client.tabsAsClient === 1) books.totals.clients += 1;

  const tab: Mut<Tab> = {
    id: id.toString(),
    number: id,
    payer_id: client.id,
    payee_id: undefined,
    invite: payee === ZERO_ADDRESS ? invite : undefined,
    memo,
    rate,
    budget,
    toppedUp: 0n,
    topUps: 0,
    paid: 0n,
    refunded: 0n,
    banked: 0n,
    open: true,
    closed: false,
    held: false,
    clockedIn: false,
    shiftCount: 0,
    secondsWorked: 0n,
    payoutCount: 0,
    rateChanges: 0,
    feePaid: 0n,
    feeRefunded: 0n,
    openedAt: books.ts,
    openedBlock: books.block,
    openedTx: event.transaction.hash,
    claimedAt: undefined,
    closedAt: undefined,
    closedBlock: undefined,
    lastActivityAt: books.ts,
    currentShift_id: undefined,
  };
  if (payee !== ZERO_ADDRESS) await engage(books, tab, payee, false);

  const t = books.totals;
  t.tabsOpened += 1;
  t.tabsOpen += 1;
  t.funded += budget;
  books.day.tabsOpened += 1;
  books.day.funded += budget;

  await recordFunding(books, tab, "open", client.id, budget, event.transaction.hash, event.logIndex);
  context.Tab.set(tab);
  books.save();
});

indexer.onEvent({ contract: "Till", event: "Claimed" }, async ({ event, context }) => {
  const books = await Books.open(context, event.block.timestamp, event.block.number);
  const tab = await tabOf(context, event.params.id);
  await engage(books, tab, event.params.payee, true);
  tab.invite = undefined;
  tab.claimedAt = books.ts;
  tab.lastActivityAt = books.ts;
  context.Tab.set(tab);
  books.save();
});

indexer.onEvent({ contract: "Till", event: "ClockedIn" }, async ({ event, context }) => {
  const books = await Books.open(context, event.block.timestamp, event.block.number);
  const tab = await tabOf(context, event.params.id);
  if (tab.payee_id) await books.person(tab.payee_id);
  const shift: Mut<Shift> = {
    id: `${tab.id}-${tab.shiftCount + 1}`,
    tab_id: tab.id,
    payee_id: tab.payee_id ?? ZERO_ADDRESS,
    start: Number(event.params.at),
    startBlock: books.block,
    end: undefined,
    endBlock: undefined,
    seconds: undefined,
    bankedAtStart: tab.banked,
    earned: undefined,
    rate: tab.rate,
    endedBy: undefined,
  };
  tab.shiftCount += 1;
  tab.clockedIn = true;
  tab.currentShift_id = shift.id;
  tab.lastActivityAt = books.ts;
  context.Shift.set(shift);
  context.Tab.set(tab);
  books.save();
});

indexer.onEvent({ contract: "Till", event: "ClockedOut" }, async ({ event, context }) => {
  const { id, by, banked } = event.params;
  const books = await Books.open(context, event.block.timestamp, event.block.number);
  const tab = await tabOf(context, id);
  await books.person(by);
  const open = tab.currentShift_id ? await context.Shift.get(tab.currentShift_id) : undefined;
  if (open) {
    const seconds = BigInt(Math.max(0, books.ts - open.start));
    const earned = banked > open.bankedAtStart ? banked - open.bankedAtStart : 0n;
    context.Shift.set({ ...open, end: books.ts, endBlock: books.block, seconds, earned, endedBy: by });
    tab.secondsWorked += seconds;
    if (tab.payee_id) {
      const freelancer = await books.person(tab.payee_id, false);
      freelancer.shifts += 1;
      freelancer.secondsWorked += seconds;
    }
    const t = books.totals;
    t.shifts += 1;
    t.secondsWorked += seconds;
    books.day.shifts += 1;
    books.day.secondsWorked += seconds;
  }
  tab.banked = banked;
  tab.clockedIn = false;
  tab.currentShift_id = undefined;
  tab.lastActivityAt = books.ts;
  context.Tab.set(tab);
  books.save();
});

indexer.onEvent({ contract: "Till", event: "ToppedUp" }, async ({ event, context }) => {
  const { id, amount, budget } = event.params;
  const books = await Books.open(context, event.block.timestamp, event.block.number);
  const tab = await tabOf(context, id);
  const client = await books.person(tab.payer_id);
  client.funded += amount;
  tab.budget = budget;
  tab.toppedUp += amount;
  tab.topUps += 1;
  tab.lastActivityAt = books.ts;
  books.totals.funded += amount;
  books.day.funded += amount;
  await recordFunding(books, tab, "topup", client.id, amount, event.transaction.hash, event.logIndex);
  context.Tab.set(tab);
  books.save();
});

indexer.onEvent({ contract: "Till", event: "Settled" }, async ({ event, context }) => {
  const { id, payee, amount, paid } = event.params;
  const books = await Books.open(context, event.block.timestamp, event.block.number);
  const tab = await tabOf(context, id);
  const freelancer = await books.person(payee);
  const client = await books.person(tab.payer_id, false);
  freelancer.earned += amount;
  freelancer.payoutsReceived += 1;
  client.paidOut += amount;

  tab.paid = paid;
  tab.payoutCount += 1;
  tab.lastActivityAt = books.ts;

  const pair = await context.Engagement.get(`${client.id}-${freelancer.id}`);
  if (pair) context.Engagement.set({ ...pair, paid: pair.paid + amount });

  // The trusted CRE rate in force for the freelancer's currency right now: events run in chain order, so the
  // latest CurrencyRate is the newest trusted report at or before this payout (a report earlier in the same
  // transaction, as in a keeper run, included). Statements price each payout at it instead of today's rate.
  const code = freelancer.currency;
  const rate = code ? await context.CurrencyRate.get(code) : undefined;

  context.Payout.set({
    id: eventId(event.transaction.hash, event.logIndex),
    tab_id: tab.id,
    payee_id: freelancer.id,
    payer_id: client.id,
    amount,
    paidToDate: paid,
    timestamp: books.ts,
    block: books.block,
    day: books.day.id,
    tx: event.transaction.hash,
    currency: code,
    rateE6: rate?.rateE6,
    rateAt: rate?.at,
    rateSnapshot_id: rate?.snapshot_id,
    localE6: rate ? (amount * rate.rateE6) / 1_000_000n : undefined,
  });

  const t = books.totals;
  t.paid += amount;
  t.payouts += 1;
  books.day.paid += amount;
  books.day.payouts += 1;
  context.Tab.set(tab);
  books.save();
});

indexer.onEvent({ contract: "Till", event: "Closed" }, async ({ event, context }) => {
  const { id, paid, refunded } = event.params;
  const books = await Books.open(context, event.block.timestamp, event.block.number);
  const tab = await tabOf(context, id);
  const client = await books.person(tab.payer_id);
  client.refunded += refunded;

  tab.paid = paid;
  tab.refunded = refunded;
  tab.open = false;
  tab.closed = true;
  tab.clockedIn = false;
  tab.closedAt = books.ts;
  tab.closedBlock = books.block;
  tab.lastActivityAt = books.ts;

  // Segundo sends back 1% of the unspent budget, capped at the fees this tab paid (see web/lib/refund.ts).
  const expected = min(min(refunded / 100n, tab.feePaid - tab.feeRefunded), feeFor(tab.budget));
  if (expected > 0n) {
    context.RefundDue.set({ id: tab.id, payer: client.id, tab_id: tab.id, expected, closedBlock: books.block });
  }

  const t = books.totals;
  t.tabsClosed += 1;
  t.tabsOpen -= 1;
  t.refunded += refunded;
  books.day.tabsClosed += 1;
  context.Tab.set(tab);
  books.save();
});

indexer.onEvent({ contract: "Till", event: "Held" }, async ({ event, context }) => {
  const books = await Books.open(context, event.block.timestamp, event.block.number);
  const tab = await tabOf(context, event.params.id);
  await books.person(tab.payer_id);
  tab.held = event.params.held;
  tab.lastActivityAt = books.ts;
  context.Tab.set(tab);
  books.save();
});

indexer.onEvent({ contract: "Till", event: "RateChanged" }, async ({ event, context }) => {
  const books = await Books.open(context, event.block.timestamp, event.block.number);
  const tab = await tabOf(context, event.params.id);
  await books.person(tab.payer_id);
  tab.rate = event.params.rate;
  tab.rateChanges += 1;
  tab.lastActivityAt = books.ts;
  context.Tab.set(tab);
  books.save();
});

indexer.onEvent({ contract: "Till", event: "ProfileSet" }, async ({ event, context }) => {
  const { who, name, place, currency } = event.params;
  const books = await Books.open(context, event.block.timestamp, event.block.number);
  const person = await books.person(who);
  person.name = name || undefined;
  person.place = place || undefined;
  person.currency = currencyCode(currency) || undefined;
  books.save();
});
