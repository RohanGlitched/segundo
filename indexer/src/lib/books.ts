import type { DailyStat, EvmOnEventContext, Person, Tab, Totals } from "envio";

/**
 * Shared bookkeeping for every handler. A handler opens the books for its event, reads and changes people,
 * the day and the running totals through them, and saves once at the end, so each row is written once per
 * event however many counters moved.
 */

export type Context = EvmOnEventContext;
export type Mut<T> = { -readonly [K in keyof T]: T[K] };

/** Segundo's treasury: the 1% client fee comes in here, fee refunds go out. */
export const TREASURY = "0xadf0f9443eafd19916cbd8f7541ea5e19e69f62c";
/** How far apart (in blocks) a fee and the open or top-up it paid for may sit, either way round. */
export const FEE_MATCH_BLOCKS = 600;
export const TOTALS_ID = "totals";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Segundo's fee on an amount a client funds: 1%, rounded up to the next AUSD unit. */
export const feeFor = (amount: bigint): bigint => (amount <= 0n ? 0n : (amount + 99n) / 100n);
/** UTC day of a unix time, "YYYY-MM-DD". */
export const dayOf = (ts: number): string => new Date(ts * 1000).toISOString().slice(0, 10);
/** Unix seconds at 00:00 UTC of a unix time's day. */
export const dayStart = (ts: number): number => ts - (ts % 86_400);
/** Event id unique on the chain. */
export const eventId = (tx: string, logIndex: number): string => `${tx}-${logIndex}`;
export const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);

/** bytes3 as hex ("0x504850") to its ASCII code ("PHP"); empty for zero bytes. */
export function currencyCode(hex: string): string {
  let out = "";
  for (let i = 2; i + 1 < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (code > 0) out += String.fromCharCode(code);
  }
  return out;
}

export const newTotals = (): Mut<Totals> => ({
  id: TOTALS_ID,
  tabsOpened: 0,
  tabsClosed: 0,
  tabsOpen: 0,
  people: 0,
  freelancers: 0,
  clients: 0,
  funded: 0n,
  paid: 0n,
  payouts: 0,
  refunded: 0n,
  fees: 0n,
  feeCount: 0,
  feeRefunds: 0n,
  feeRefundCount: 0,
  netFees: 0n,
  unlinkedInflow: 0n,
  otherOutflow: 0n,
  shifts: 0,
  secondsWorked: 0n,
  rateReports: 0,
  keeperRuns: 0,
  keeperPaid: 0n,
  keeperSkipped: 0,
  lastBlock: 0,
  lastTimestamp: 0,
});

export const newDay = (ts: number): Mut<DailyStat> => ({
  id: dayOf(ts),
  date: dayStart(ts),
  payouts: 0,
  paid: 0n,
  fees: 0n,
  feeCount: 0,
  refunds: 0n,
  refundCount: 0,
  tabsOpened: 0,
  tabsClosed: 0,
  funded: 0n,
  shifts: 0,
  secondsWorked: 0n,
  activePeople: 0,
  newPeople: 0,
});

const newPerson = (id: string, ts: number, block: number): Mut<Person> => ({
  id,
  name: undefined,
  place: undefined,
  currency: undefined,
  earned: 0n,
  payoutsReceived: 0,
  paidOut: 0n,
  funded: 0n,
  refunded: 0n,
  feesPaid: 0n,
  feesRefunded: 0n,
  tabsAsClient: 0,
  tabsAsFreelancer: 0,
  clients: 0,
  freelancers: 0,
  shifts: 0,
  secondsWorked: 0n,
  firstSeen: ts,
  firstSeenBlock: block,
  lastActive: ts,
});

export class Books {
  private readonly people = new Map<string, Mut<Person>>();
  private readonly days = new Map<string, Mut<DailyStat>>();
  /** People already counted as active today within this event. */
  private readonly marked = new Set<string>();

  private constructor(
    readonly context: Context,
    readonly totals: Mut<Totals>,
    readonly day: Mut<DailyStat>,
    readonly ts: number,
    readonly block: number,
  ) {
    this.days.set(day.id, day);
  }

  static async open(context: Context, ts: number, block: number): Promise<Books> {
    const [totals, day] = await Promise.all([context.Totals.get(TOTALS_ID), context.DailyStat.get(dayOf(ts))]);
    const books = new Books(context, totals ? { ...totals } : newTotals(), day ? { ...day } : newDay(ts), ts, block);
    books.totals.lastBlock = Math.max(books.totals.lastBlock, block);
    books.totals.lastTimestamp = Math.max(books.totals.lastTimestamp, ts);
    return books;
  }

  /** Another day's row (a fee linked to a later open counts on the day the fee was paid). */
  async dayFor(ts: number): Promise<Mut<DailyStat>> {
    const id = dayOf(ts);
    const held = this.days.get(id);
    if (held) return held;
    const row = await this.context.DailyStat.get(id);
    const day = row ? { ...row } : newDay(ts);
    this.days.set(id, day);
    return day;
  }

  /**
   * A person, created on first sight. `active` marks them active today (counted once per day); pass false for
   * someone an event only mentions, like a freelancer named on a tab before they've done anything.
   */
  async person(address: string, active = true): Promise<Mut<Person>> {
    const id = address.toLowerCase();
    let p = this.people.get(id);
    if (!p) {
      const row = await this.context.Person.get(id);
      if (row) p = { ...row };
      else {
        p = newPerson(id, this.ts, this.block);
        this.totals.people += 1;
        this.day.newPeople += 1;
      }
      this.people.set(id, p);
    }
    if (active) {
      p.lastActive = Math.max(p.lastActive, this.ts);
      const mark = `${this.day.id}-${id}`;
      if (!this.marked.has(mark) && !(await this.context.PersonDay.get(mark))) {
        this.marked.add(mark);
        this.context.PersonDay.set({ id: mark });
        this.day.activePeople += 1;
      }
    }
    return p;
  }

  save(): void {
    for (const p of this.people.values()) this.context.Person.set(p);
    for (const d of this.days.values()) this.context.DailyStat.set(d);
    this.context.Totals.set(this.totals);
  }
}

/** A tab that must exist (every Till event after Opened names one). */
export async function tabOf(context: Context, id: bigint): Promise<Mut<Tab>> {
  return { ...(await context.Tab.getOrThrow(id.toString(), `Tab ${id} has no Opened event`)) };
}
