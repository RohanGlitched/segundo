import { indexer } from "envio";
import { Books, TREASURY } from "../lib/books";
import { recordFee, recordOutflow } from "../lib/fees";

/**
 * Agora AUSD transfers that touch Segundo's treasury. The `where` filter goes to HyperSync as a topic filter, so
 * only these transfers are ever fetched, not every AUSD transfer on Monad testnet.
 */
indexer.onEvent(
  {
    contract: "AUSD",
    event: "Transfer",
    where: { params: [{ to: TREASURY }, { from: TREASURY }] },
  },
  async ({ event, context }) => {
    const { from, to, value } = event.params;
    const toTreasury = to.toLowerCase() === TREASURY;
    const fromTreasury = from.toLowerCase() === TREASURY;
    if (toTreasury === fromTreasury || value === 0n) return;

    const books = await Books.open(context, event.block.timestamp, event.block.number);
    if (toTreasury) await recordFee(books, from.toLowerCase(), value, event.transaction.hash, event.logIndex);
    else await recordOutflow(books, to.toLowerCase(), value, event.transaction.hash, event.logIndex);
    books.save();
  },
);
