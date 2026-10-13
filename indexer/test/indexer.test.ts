import { describe, it } from "vitest";
import { createTestIndexer } from "envio";

/**
 * Handler tests on simulated events: no network, no database, no Docker.
 * Money is AUSD base units (6 decimals): 1_000_000n is one dollar.
 */

const CHAIN = 10143;
const TREASURY = "0xadf0f9443eafd19916cbd8f7541ea5e19e69f62c";
const ZERO = "0x0000000000000000000000000000000000000000";
const CLIENT = "0x1111111111111111111111111111111111111111";
const FREELANCER = "0x2222222222222222222222222222222222222222";
const INVITE = "0x3333333333333333333333333333333333333333";
const STRANGER = "0x4444444444444444444444444444444444444444";
const B0 = 70_700_000;
const T0 = 1_791_000_000;
const DAY = new Date(T0 * 1000).toISOString().slice(0, 10);

const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
/** Block and transaction for the n-th simulated event: one block (and about a second) apart. */
const at = (n: number, seconds = n) => ({
  block: { number: B0 + n, timestamp: T0 + seconds },
  transaction: { hash: tx(n) },
});

describe("a tab from fee to refund", () => {
  it("keeps the tab, the people, the day and the totals in step", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            // The 1% fee on a $100 budget goes first, then the open.
            { contract: "AUSD", event: "Transfer", ...at(0), params: { from: CLIENT, to: TREASURY, value: 1_000_000n } },
            {
              contract: "Till",
              event: "Opened",
              ...at(1),
              params: { id: 1n, payer: CLIENT, payee: FREELANCER, rate: 36_000_000n, budget: 100_000_000n, invite: ZERO, memo: "Logo" },
            },
            { contract: "Till", event: "ClockedIn", ...at(2), params: { id: 1n, at: BigInt(T0 + 2) } },
            // An hour at $36/h.
            { contract: "Till", event: "ClockedOut", ...at(3, 3602), params: { id: 1n, by: FREELANCER, banked: 36_000_000n } },
            { contract: "Till", event: "Settled", ...at(4, 3603), params: { id: 1n, payee: FREELANCER, amount: 36_000_000n, paid: 36_000_000n } },
            { contract: "Till", event: "Closed", ...at(5, 3604), params: { id: 1n, paid: 36_000_000n, refunded: 64_000_000n } },
            // 1% of the $64 returned goes back to the client.
            { contract: "AUSD", event: "Transfer", ...at(6, 3605), params: { from: TREASURY, to: CLIENT, value: 640_000n } },
          ],
        },
      },
    });

    const totals = await indexer.Totals.getOrThrow("totals");
    t.expect(totals).toMatchObject({
      tabsOpened: 1,
      tabsClosed: 1,
      tabsOpen: 0,
      people: 2,
      clients: 1,
      freelancers: 1,
      funded: 100_000_000n,
      paid: 36_000_000n,
      payouts: 1,
      refunded: 64_000_000n,
      fees: 1_000_000n,
      feeCount: 1,
      feeRefunds: 640_000n,
      feeRefundCount: 1,
      netFees: 360_000n,
      unlinkedInflow: 0n,
      otherOutflow: 0n,
      shifts: 1,
      secondsWorked: 3600n,
    });

    const tab = await indexer.Tab.getOrThrow("1");
    t.expect(tab).toMatchObject({
      payer_id: CLIENT,
      payee_id: FREELANCER,
      budget: 100_000_000n,
      paid: 36_000_000n,
      refunded: 64_000_000n,
      open: false,
      closed: true,
      clockedIn: false,
      shiftCount: 1,
      secondsWorked: 3600n,
      payoutCount: 1,
      feePaid: 1_000_000n,
      feeRefunded: 640_000n,
      memo: "Logo",
    });

    t.expect(await indexer.Person.getOrThrow(FREELANCER)).toMatchObject({
      earned: 36_000_000n,
      payoutsReceived: 1,
      clients: 1,
      tabsAsFreelancer: 1,
      shifts: 1,
      secondsWorked: 3600n,
    });
    t.expect(await indexer.Person.getOrThrow(CLIENT)).toMatchObject({
      paidOut: 36_000_000n,
      funded: 100_000_000n,
      refunded: 64_000_000n,
      feesPaid: 1_000_000n,
      feesRefunded: 640_000n,
      freelancers: 1,
      tabsAsClient: 1,
    });

    const shift = await indexer.Shift.getOrThrow("1-1");
    t.expect(shift).toMatchObject({ seconds: 3600n, earned: 36_000_000n, rate: 36_000_000n, endedBy: FREELANCER });

    const fees = await indexer.Fee.getAll();
    t.expect(fees).toHaveLength(1);
    t.expect(fees[0]).toMatchObject({ linked: true, tab_id: "1", payer_id: CLIENT, amount: 1_000_000n });

    const refunds = await indexer.FeeRefund.getAll();
    t.expect(refunds).toHaveLength(1);
    t.expect(refunds[0]).toMatchObject({ kind: "close", tab_id: "1", amount: 640_000n });
    t.expect(await indexer.RefundDue.getAll()).toHaveLength(0);

    t.expect(await indexer.Engagement.getOrThrow(`${CLIENT}-${FREELANCER}`)).toMatchObject({ tabs: 1, paid: 36_000_000n });

    t.expect(await indexer.DailyStat.getOrThrow(DAY)).toMatchObject({
      payouts: 1,
      paid: 36_000_000n,
      fees: 1_000_000n,
      feeCount: 1,
      refunds: 640_000n,
      refundCount: 1,
      tabsOpened: 1,
      tabsClosed: 1,
      funded: 100_000_000n,
      shifts: 1,
      secondsWorked: 3600n,
      activePeople: 2,
      newPeople: 2,
    });
  });
});

describe("fees", () => {
  it("links a fee that follows its open, and one that precedes a top-up; strangers' transfers aren't revenue", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            // A tab opened by invite link: no payee until the freelancer claims it.
            {
              contract: "Till",
              event: "Opened",
              ...at(0),
              params: { id: 2n, payer: CLIENT, payee: ZERO, rate: 20_000_000n, budget: 50_000_000n, invite: INVITE, memo: "" },
            },
            // The older order: the fee lands two blocks after the open.
            { contract: "AUSD", event: "Transfer", ...at(2), params: { from: CLIENT, to: TREASURY, value: 500_000n } },
            { contract: "Till", event: "Claimed", ...at(3), params: { id: 2n, payee: FREELANCER } },
            // A $25.50 top-up: its fee rounds up to 255,000 units and goes first.
            { contract: "AUSD", event: "Transfer", ...at(4), params: { from: CLIENT, to: TREASURY, value: 255_000n } },
            { contract: "Till", event: "ToppedUp", ...at(5), params: { id: 2n, amount: 25_500_000n, budget: 75_500_000n } },
            // Someone sends AUSD to the treasury; the treasury sends someone else AUSD.
            { contract: "AUSD", event: "Transfer", ...at(6), params: { from: STRANGER, to: TREASURY, value: 12_345n } },
            { contract: "AUSD", event: "Transfer", ...at(7), params: { from: TREASURY, to: STRANGER, value: 5n } },
            // Unrelated AUSD transfer (the `where` filter keeps these out on chain; the handler ignores them too).
            { contract: "AUSD", event: "Transfer", ...at(8), params: { from: STRANGER, to: CLIENT, value: 7n } },
          ],
        },
      },
    });

    const totals = await indexer.Totals.getOrThrow("totals");
    t.expect(totals).toMatchObject({
      fees: 755_000n,
      feeCount: 2,
      netFees: 755_000n,
      unlinkedInflow: 12_345n,
      otherOutflow: 5n,
      funded: 75_500_000n,
      people: 2,
      freelancers: 1,
      clients: 1,
    });

    const tab = await indexer.Tab.getOrThrow("2");
    t.expect(tab).toMatchObject({
      payee_id: FREELANCER,
      invite: undefined,
      budget: 75_500_000n,
      toppedUp: 25_500_000n,
      topUps: 1,
      feePaid: 755_000n,
      claimedAt: T0 + 3,
    });
    t.expect(await indexer.Person.getOrThrow(FREELANCER)).toMatchObject({ clients: 1, tabsAsFreelancer: 1 });

    const fundings = await indexer.Funding.getAll();
    t.expect(fundings).toHaveLength(2);
    t.expect(fundings.every((f) => f.fee_id !== undefined)).toBe(true);
    const stranger = (await indexer.Fee.getAll()).find((f) => f.from === STRANGER);
    t.expect(stranger).toMatchObject({ linked: false, tab_id: undefined });
  });

  it("treats a whole fee sent back after a failed open as a returned transfer, not a refund of revenue", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            { contract: "AUSD", event: "Transfer", ...at(0), params: { from: CLIENT, to: TREASURY, value: 1_000_000n } },
            { contract: "AUSD", event: "Transfer", ...at(3), params: { from: TREASURY, to: CLIENT, value: 1_000_000n } },
          ],
        },
      },
    });
    t.expect(await indexer.Totals.getOrThrow("totals")).toMatchObject({ fees: 0n, feeRefunds: 0n, unlinkedInflow: 0n, otherOutflow: 0n });
    const refunds = await indexer.FeeRefund.getAll();
    t.expect(refunds).toHaveLength(1);
    t.expect(refunds[0]).toMatchObject({ kind: "failed", amount: 1_000_000n });
    t.expect((await indexer.Fee.getAll())[0]).toMatchObject({ refundedInFull: true, linked: false });
  });
});

describe("profiles", () => {
  it("decodes the bytes3 currency code and keeps the name and place", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            { contract: "Till", event: "ProfileSet", ...at(0), params: { who: FREELANCER, name: "Ana", place: "Manila", currency: "0x504850" } },
          ],
        },
      },
    });
    t.expect(await indexer.Person.getOrThrow(FREELANCER)).toMatchObject({ name: "Ana", place: "Manila", currency: "PHP" });
  });
});

describe("Chainlink CRE keeper", () => {
  it("keeps the latest rate per currency and counts skipped tabs in a run", async (t) => {
    const indexer = createTestIndexer();
    const php = "0x504850";
    const inr = "0x494e52";
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            { contract: "SegundoKeeper", event: "RatesPosted", ...at(0), params: { at: BigInt(T0), currencies: [php, inr], ratesE6: [57_000_000n, 83_000_000n] } },
            { contract: "SegundoKeeper", event: "RatesPosted", ...at(1), params: { at: BigInt(T0 + 60), currencies: [php], ratesE6: [57_250_000n] } },
            // One report: tab 9 couldn't be paid, two others were.
            { contract: "SegundoKeeper", event: "SettleSkipped", ...at(2), params: { id: 9n } },
            { contract: "SegundoKeeper", event: "Kept", ...at(2), logIndex: 5, params: { at: BigInt(T0 + 120), tabs: 3n, paid: 4_200n } },
          ],
        },
      },
    });

    t.expect(await indexer.CurrencyRate.getOrThrow("PHP")).toMatchObject({ rateE6: 57_250_000n, at: T0 + 60, updates: 2 });
    t.expect(await indexer.CurrencyRate.getOrThrow("INR")).toMatchObject({ rateE6: 83_000_000n, at: T0, updates: 1 });
    const snapshots = await indexer.RateSnapshot.getAll();
    t.expect(snapshots).toHaveLength(2);
    t.expect(snapshots.find((s) => s.at === T0)?.currencies).toEqual(["PHP", "INR"]);

    const runs = await indexer.KeeperRun.getAll();
    t.expect(runs).toHaveLength(1);
    t.expect(runs[0]).toMatchObject({ tabs: 3, paid: 4_200n, skipped: 1 });
    t.expect(await indexer.Totals.getOrThrow("totals")).toMatchObject({ rateReports: 2, keeperRuns: 1, keeperPaid: 4_200n, keeperSkipped: 1 });
  });
});
