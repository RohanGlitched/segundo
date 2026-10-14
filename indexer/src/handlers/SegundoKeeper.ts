import { indexer } from "envio";
import { Books, currencyCode, eventId, trustedReport } from "../lib/books";

/**
 * SegundoKeeper: the receiver for Segundo's Chainlink CRE workflow. Each report posts the exchange rates the
 * DON agreed on and settles the tabs that are owed.
 *
 * On testnet the reports come through Chainlink's MockKeystoneForwarder, which anyone can call. Every report is
 * recorded with its sender, but only those from Segundo's reporting keys (lib/books.ts CRE_REPORTERS) are trusted:
 * the rest never move CurrencyRate (so never price a payout) and count only in Totals.untrustedReports.
 */

indexer.onEvent({ contract: "SegundoKeeper", event: "RatesPosted" }, async ({ event, context }) => {
  const { currencies, ratesE6 } = event.params;
  const at = Number(event.params.at);
  const books = await Books.open(context, event.block.timestamp, event.block.number);
  const id = eventId(event.transaction.hash, event.logIndex);
  const codes = currencies.map(currencyCode);
  const from = (event.transaction.from ?? "").toLowerCase();
  const trusted = trustedReport(from, at, books.ts);
  context.RateSnapshot.set({
    id,
    at,
    currencies: codes,
    ratesE6: [...ratesE6],
    from,
    trusted,
    block: books.block,
    timestamp: books.ts,
    tx: event.transaction.hash,
  });
  if (!trusted) {
    books.totals.untrustedReports += 1;
    books.save();
    return;
  }
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
  const from = (event.transaction.from ?? "").toLowerCase();
  const trusted = trustedReport(from, Number(at), books.ts);
  context.KeeperRun.set({
    id: eventId(event.transaction.hash, event.logIndex),
    at: Number(at),
    tabs: Number(tabs),
    paid,
    skipped,
    from,
    trusted,
    block: books.block,
    timestamp: books.ts,
    tx: event.transaction.hash,
  });
  const t = books.totals;
  // The payouts themselves are real either way (Till's Settled events count them); only the run is not Segundo's.
  if (!trusted) {
    t.untrustedReports += 1;
    books.save();
    return;
  }
  t.keeperRuns += 1;
  t.keeperPaid += paid;
  t.keeperSkipped += skipped;
  books.save();
});
