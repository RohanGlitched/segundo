import "server-only";
import { concat, decodeEventLog, encodeEventTopics, keccak256, pad, parseAbi, parseAbiItem, stringToHex, toHex, type Address, type Hex } from "viem";
import { tillAbi } from "./abi";
import { authorizationCall, authorize } from "./authorization";
import { DOLLAR, TILL, TREASURY, publicClient } from "./chain";
import { ledger } from "./envio";
import { feeFor } from "./money";
import { sendAndWait, signer } from "./server";

/**
 * Segundo's fee is 1% of what a client funds, but clients should only pay for time worked. When a tab closes,
 * the treasury sends back 1% of the unspent budget the contract returned, capped at the fees that tab actually
 * paid. When a fee is collected and the open or top-up it paid for then fails, the whole fee goes back.
 *
 * Every refund is an AUSD transfer authorisation (EIP-3009) signed by the treasury and submitted by the relayer,
 * so the treasury never needs MON. Its nonce is derived from what is being refunded (the tab, or the client's
 * fee authorisation), so AUSD itself refuses a second refund of the same thing, on any server instance.
 */

export type Refund = { value: bigint; hash: Hex; block: number };

const authAbi = parseAbi(["function authorizationState(address authorizer, bytes32 nonce) view returns (bool)"]);
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const TAB_TOPICS = (["Opened", "ToppedUp", "Closed", "Activity"] as const).map((eventName) => encodeEventTopics({ abi: tillAbi, eventName } as never)[0] as Hex);

/**
 * Where the fee transfer that paid for a funding may sit: before it (the fee goes first, and a busy relayer can take
 * many seconds between the two) or, for tabs from before that order, just after it. The public RPC caps a log query at 100 blocks.
 */
const FEE_BEFORE = 3n;
const FEE_AFTER = 40n;
const SPAN = 99n;
/** Activity links walked block by block before the indexed ledger is asked instead. */
const WALK_STEPS = 40;

/** One refund per closed tab. */
export const tabRefundNonce = (id: bigint) => keccak256(concat([stringToHex("segundo:fee-refund:tab"), pad(TILL), pad(toHex(id))]));
/** One refund per client fee authorisation. */
export const feeRefundNonce = (clientNonce: Hex) => keccak256(concat([stringToHex("segundo:fee-refund:fee"), clientNonce]));

/** True once the treasury has used this refund nonce: the refund already went. */
export const refunded = (nonce: Hex) =>
  publicClient.readContract({ address: DOLLAR, abi: authAbi, functionName: "authorizationState", args: [TREASURY, nonce] });

/** Pays AUSD out of the treasury: the treasury signs, the relayer submits. */
export async function fromTreasury(to: Address, value: bigint, nonce: Hex): Promise<Refund> {
  const auth = await authorize(signer("treasury").account, to, value, nonce);
  const { logs: _logs, ...sent } = await sendAndWait(signer("keeper"), { to: DOLLAR, data: authorizationCall(auth).data });
  return { value, ...sent };
}

type Funding = { block: bigint; amount: bigint; key: string };
type TabLogs = { refunded: bigint | null; fundings: Funding[]; complete: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const blockLogs = (block: bigint, idTopic: Hex) =>
  publicClient.request({
    method: "eth_getLogs",
    params: [{ address: TILL, fromBlock: toHex(block), toBlock: toHex(block), topics: [TAB_TOPICS, idTopic] }],
  });

/**
 * Walks a tab's history backwards from its last block: every block a tab touched holds an Activity event naming
 * the block before it. Long tabs (a watched tab is paid out every few seconds) switch to the indexed ledger.
 */
async function tabLogs(id: bigint, last: bigint): Promise<TabLogs> {
  const idTopic = pad(toHex(id));
  const out: TabLogs = { refunded: null, fundings: [], complete: false };
  const seen = new Set<string>();
  let block = last;
  for (let step = 0; step < WALK_STEPS && block > 0n; step++) {
    let logs = await blockLogs(block, idTopic);
    // A node that has just handed back the close receipt may not serve that block's logs for a moment.
    for (let wait = 0; step === 0 && logs.length === 0 && wait < 4; wait++) {
      await sleep(400);
      logs = await blockLogs(block, idTopic);
    }
    let prev: bigint | null = null;
    for (const l of logs) {
      const ev = decodeEventLog({ abi: tillAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      const key = `${l.transactionHash}:${Number(l.logIndex)}`;
      if (ev.eventName === "Activity") prev = (ev.args as { prevBlock: bigint }).prevBlock;
      else if (ev.eventName === "Closed") out.refunded = (ev.args as { refunded: bigint }).refunded;
      else if (!seen.has(key) && (ev.eventName === "Opened" || ev.eventName === "ToppedUp")) {
        seen.add(key);
        const a = ev.args as { budget?: bigint; amount?: bigint };
        out.fundings.push({ block, amount: ev.eventName === "Opened" ? a.budget! : a.amount!, key });
      }
    }
    if (prev === null) return out; // a broken link: what was found so far is all that is counted
    if (prev === 0n) return { ...out, complete: true };
    block = prev;
  }
  // The rest of the history comes from the indexed ledger, when it reaches this far.
  try {
    const l = await ledger();
    if (l.source === "envio-hyperrpc" && l.head >= block) {
      for (const ev of l.events) {
        if (ev.id !== id || BigInt(ev.block) > block) continue;
        const key = `${ev.hash}:${ev.logIndex}`;
        if (seen.has(key)) continue;
        if (ev.name === "Opened") out.fundings.push({ block: BigInt(ev.block), amount: ev.budget, key });
        else if (ev.name === "ToppedUp") out.fundings.push({ block: BigInt(ev.block), amount: ev.amount, key });
        else continue;
        seen.add(key);
      }
      return { ...out, complete: true };
    }
  } catch (e) {
    console.warn(`fee refund: ledger unavailable for tab ${id}: ${e instanceof Error ? e.message : e}`);
  }
  return out;
}

/** The fees a client actually paid for these fundings: each one matched to the nearest unused fee transfer to the treasury. */
async function feesPaid(payer: Address, fundings: Funding[]): Promise<bigint> {
  const found = new Map<string, { block: bigint; value: bigint }>();
  await Promise.all(
    fundings.flatMap((f) => {
      const ranges: [bigint, bigint][] = [[f.block + 1n, f.block + FEE_AFTER]];
      for (let i = 0n; i < FEE_BEFORE; i++) ranges.push([f.block - SPAN * (i + 1n) + 1n, f.block - SPAN * i]);
      return ranges.map(async ([from, to]) => {
        const logs = await publicClient
          .getLogs({ address: DOLLAR, event: transferEvent, args: { from: payer, to: TREASURY }, fromBlock: from, toBlock: to })
          .catch((e) => {
            console.warn(`fee refund: couldn't read fees in ${from}-${to}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
            return [];
          });
        for (const l of logs) found.set(`${l.transactionHash}:${l.logIndex}`, { block: l.blockNumber, value: l.args.value ?? 0n });
      });
    }),
  );
  const unused = [...found.values()];
  let paid = 0n;
  for (const f of [...fundings].sort((a, b) => (a.block < b.block ? -1 : 1))) {
    const owed = feeFor(f.amount);
    const distance = (b: bigint) => (b > f.block ? b - f.block : f.block - b);
    let best = -1;
    unused.forEach((t, i) => {
      if (t.value >= owed && (best < 0 || distance(t.block) < distance(unused[best]!.block))) best = i;
    });
    if (best < 0) continue; // no fee went with this funding (tabs from before the fee, or a fee that failed)
    paid += owed;
    unused.splice(best, 1);
  }
  return paid;
}

export type TabRefund = { value: bigint; hash?: Hex; block?: number; note?: string };

/**
 * The fee refund for a closed tab: floor(1% of the unspent budget returned at close), never more than the fees the
 * tab's client actually paid, nor 1% of everything the tab was funded with. Sent once; a second call says so.
 */
export async function refundClosedTab(id: bigint, justClosed = false): Promise<TabRefund> {
  const read = async () =>
    ((await publicClient.readContract({ address: TILL, abi: tillAbi, functionName: "getTab", args: [id] })) as {
      tab: { payer: Address; closed: boolean; lastBlock: bigint; budget: bigint };
    }).tab;
  let t = await read();
  if (/^0x0+$/.test(t.payer)) throw new Error("There is no such tab.");
  // Straight after the close lands, a node a block behind may still show the tab open.
  for (let wait = 0; justClosed && !t.closed && wait < 4; wait++) {
    await sleep(400);
    t = await read();
  }
  if (!t.closed) throw new Error("This tab is still open.");
  const nonce = tabRefundNonce(id);
  if (await refunded(nonce)) return { value: 0n, note: "already refunded" };
  const history = await tabLogs(id, t.lastBlock);
  if (history.refunded === null) throw new Error(`couldn't find tab ${id}'s close`);
  const owed = history.refunded / 100n;
  if (owed === 0n) return { value: 0n, note: "no unspent budget" };
  const paid = await feesPaid(t.payer, history.fundings);
  if (!history.complete) console.warn(`fee refund: tab ${id}'s history was read only in part; refunding against the fees found`);
  let value = owed;
  if (value > paid) value = paid;
  if (value > feeFor(t.budget)) value = feeFor(t.budget);
  if (value === 0n) return { value: 0n, note: "no fee was collected on this tab" };
  return fromTreasury(t.payer, value, nonce);
}
