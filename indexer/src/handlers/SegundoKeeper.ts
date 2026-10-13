import { indexer } from "envio";
import { Books, currencyCode, eventId } from "../lib/books";

/**
 * SegundoKeeper: the receiver for Segundo's Chainlink CRE workflow. Each report posts the exchange rates the
 * DON agreed on and settles the tabs that are owed.
 */

indexer.onEvent({ contract: "SegundoKeeper", event: "RatesPosted" }, async ({ event, context }) => {
  const { currencies, ratesE6 } = event.params;
  const at = Number(event.params.at);
  const books = await Books.open(context, event.block.timestamp, event.block.number);
  const id = eventId(event.transaction.hash, event.logIndex);
  const codes = currencies.map(currencyCode);
  context.RateSnapshot.set({
    id,
    at,
    currencies: codes,
    ratesE6: [...ratesE6],
    block: books.block,
    timestamp: books.ts,
    tx: event.transaction.hash,
  });
  await Promise.all(
    codes.map(async (code, i) => {
      const rateE6 = ratesE6[i];
      if (!code || rateE6 === undefined) return;
      const latest = await context.CurrencyRate.get(code);
      if (latest && latest.at > at) return;
      context.CurrencyRate.set({ id: code, rateE6, at, snapshot_id: id, updates: (latest?.updates ?? 0) + 1 });
    }),
  );
  books.totals.rateReports += 1;
  books.save();
});

indexer.onEvent({ contract: "SegundoKeeper", event: "SettleSkipped" }, async ({ event, context }) => {
  context.SkippedSettle.set({
    id: eventId(event.transaction.hash, event.logIndex),
    tab: event.params.id.toString(),
    tx: event.transaction.hash,
    block: event.block.number,
    timestamp: event.block.timestamp,
  });
});

indexer.onEvent({ contract: "SegundoKeeper", event: "Kept" }, async ({ event, context }) => {
  const { at, tabs, paid } = event.params;
  const books = await Books.open(context, event.block.timestamp, event.block.number);
  // SettleSkipped comes earlier in the same transaction, one per tab that couldn't be paid.
  const skipped = (await context.SkippedSettle.getWhere({ tx: { _eq: event.transaction.hash } })).length;
  context.KeeperRun.set({
    id: eventId(event.transaction.hash, event.logIndex),
    at: Number(at),
    tabs: Number(tabs),
    paid,
    skipped,
    block: books.block,
    timestamp: books.ts,
    tx: event.transaction.hash,
  });
  const t = books.totals;
  t.keeperRuns += 1;
  t.keeperPaid += paid;
  t.keeperSkipped += skipped;
  books.save();
});
