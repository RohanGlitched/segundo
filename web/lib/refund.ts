import "server-only";
import { concat, decodeEventLog, decodeFunctionData, encodeEventTopics, getAddress, keccak256, pad, parseAbi, parseAbiItem, recoverTypedDataAddress, stringToHex, toHex, type Address, type Hex } from "viem";
import { forwarderAbi, tillAbi } from "./abi";
import { authorizationCall, authorize, type SignedAuthorization } from "./authorization";
import { DOLLAR, DOLLAR_DOMAIN, FORWARDER, TILL, TREASURY, dollarAbi, monadTestnet, publicClient } from "./chain";
import { ledger } from "./envio";
import { feeFor } from "./money";
import { REFUND_WALLET_CAP, privySignTypedData, refundWallet } from "./privy-server";
import { sendAndWait, signer } from "./server";

/**
 * Segundo's fee is 1% of what a client funds, but clients should only pay for time worked. When a tab closes,
 * the treasury sends back 1% of the unspent budget the contract returned, capped at the fees that tab actually
 * paid. When a fee is collected and the open or top-up it paid for then fails, the whole fee goes back.
 *
 * Every refund is an AUSD transfer authorisation (EIP-3009) submitted by the relayer, so the signer never needs MON.
 * The signer is Segundo's refund wallet, a Privy server wallet whose Privy policy allows only AUSD authorisations on
 * Monad testnet of at most 50 AUSD (lib/privy-server.ts); the treasury, which keeps receiving the fees, tops that
 * wallet up when it runs short. A refund over the cap, or any refund on a deployment without the Privy wallet, is
 * signed by the treasury key as before. Which one signs depends only on the amount, never on a failure, so a retry
 * always asks the same signer.
 *
 * The nonce is derived from the client's own fee authorisation, whether the fee comes back whole (a failed open) or
 * in part (at close), so AUSD itself refuses a second refund of any fee, on any server instance and for any tab; a
 * refund counts as sent when any refund signer, past or present, has used that nonce.
 */

export type Refund = { value: bigint; hash: Hex; block: number; from?: Address };

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

/** The nonce close refunds used before they went per fee; a tab refunded under it is not refunded again. */
export const tabRefundNonce = (id: bigint) => keccak256(concat([stringToHex("segundo:fee-refund:tab"), pad(TILL), pad(toHex(id))]));
/** One refund per client fee authorisation, whole or in part, by any path. */
export const feeRefundNonce = (clientNonce: Hex) => keccak256(concat([stringToHex("segundo:fee-refund:fee"), clientNonce]));

/**
 * Every account that has signed refunds: the treasury and Segundo's Privy refund wallets. Kept here, not only in
 * env, so that unsetting or replacing the Privy wallet can never make an earlier refund look unsent.
 */
export const PAST_REFUND_SIGNERS: readonly Address[] = [TREASURY, "0xB6A43604330f4e678735F98f5316c7887767A941"];

/** True once any refund signer has used this refund nonce: the refund already went. */
export async function refunded(nonce: Hex): Promise<boolean> {
  const wallet = await refundWallet();
  const signers = [...new Set([...PAST_REFUND_SIGNERS, ...(wallet ? [wallet.address] : [])].map((a) => getAddress(a)))];
  const used = await Promise.all(
    signers.map((a) => publicClient.readContract({ address: DOLLAR, abi: authAbi, functionName: "authorizationState", args: [a, nonce] }) as Promise<boolean>),
  );
  return used.some(Boolean);
}

/** When the refund wallet holds less than a refund, the treasury moves this much (or the refund, if larger) into it first. */
export const REFILL = 20_000_000n;

/** EIP-3009's message, with the domain type spelled out: Privy's policy matches the typed data's full set of types. */
const transferTypes = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** The refund wallet signs an AUSD transfer authorisation through Privy, which checks it against the wallet's policy. */
async function privyAuthorize(wallet: { id: string; address: Address }, to: Address, value: bigint, nonce: Hex): Promise<SignedAuthorization> {
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 900);
  const domain = { ...DOLLAR_DOMAIN, chainId: monadTestnet.id, verifyingContract: DOLLAR };
  const message = { from: wallet.address, to, value, validAfter: 0n, validBefore, nonce };
  const signature = await privySignTypedData(wallet.id, {
    domain,
    types: transferTypes,
    primaryType: "TransferWithAuthorization",
    message: { ...message, value: value.toString(), validAfter: "0", validBefore: validBefore.toString() },
  });
  const { EIP712Domain: _domain, ...types } = transferTypes;
  const by = await recoverTypedDataAddress({ domain, types, primaryType: "TransferWithAuthorization", message, signature });
  if (by.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("The refund wallet's signature didn't check out.");
  return { from: wallet.address, to, value: value.toString(), validBefore: validBefore.toString(), nonce, signature };
}

const submit = async (auth: SignedAuthorization) => {
  const { logs: _logs, ...sent } = await sendAndWait(signer("keeper"), { to: DOLLAR, data: authorizationCall(auth).data });
  return sent;
};

/**
 * Pays a refund in AUSD: signed by the Privy refund wallet when it is set up and the refund is within its policy's
 * cap, otherwise by the treasury; submitted by the relayer either way. Short of AUSD, the refund wallet is first
 * topped up from the treasury (a transfer under a fresh nonce: two at once only leave a little more in the float).
 */
export async function fromTreasury(to: Address, value: bigint, nonce: Hex): Promise<Refund> {
  const wallet = value <= REFUND_WALLET_CAP ? await refundWallet() : null;
  if (!wallet) return { value, ...(await submit(await authorize(signer("treasury").account, to, value, nonce))), from: TREASURY };
  const float = (await publicClient.readContract({ address: DOLLAR, abi: dollarAbi, functionName: "balanceOf", args: [wallet.address] })) as bigint;
  if (float < value) {
    const refill = value > REFILL ? value : REFILL;
    const topUpNonce = keccak256(concat([stringToHex("segundo:refund-float"), nonce, toHex(Date.now())]));
    await submit(await authorize(signer("treasury").account, wallet.address, refill, topUpNonce));
  }
  return { value, ...(await submit(await privyAuthorize(wallet, to, value, nonce))), from: wallet.address };
}

type Funding = { block: bigint; amount: bigint; key: string; hash: Hex };
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
        out.fundings.push({ block, amount: ev.eventName === "Opened" ? a.budget! : a.amount!, key, hash: l.transactionHash as Hex });
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
        if (ev.name === "Opened") out.fundings.push({ block: BigInt(ev.block), amount: ev.budget, key, hash: ev.hash });
        else if (ev.name === "ToppedUp") out.fundings.push({ block: BigInt(ev.block), amount: ev.amount, key, hash: ev.hash });
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

/**
 * A fee as it sits on chain: an AUSD Transfer from the client to the treasury, made by a transferWithAuthorization
 * (EIP-3009) whose own nonce is the client's. `sender` and `txNonce` are those of the transaction that submitted it.
 */
export type PaidFee = { hash: Hex; block: bigint; value: bigint; sender: Address; txNonce: number; clientNonce: Hex };
/** A funding with the transaction that made it. */
export type SentFunding = Funding & { sender: Address; txNonce: number };

/**
 * Pairs each funding with the fee that paid for it, one to one. A fee counts for a funding only when the same
 * account submitted both (the relayer key that served the request, or a demo studio's keeper), it covers 1% of the
 * funding, and no other funding of this tab took it. The relayer sends the fee just before the open or top-up, so
 * the nearest earlier transaction of that key wins; older tabs and the demo studios paid just after.
 * A tab funded straight on Till, or through the forwarder with the client's own gas, pairs with nothing: no fee
 * went with it, so nothing comes back for it.
 */
export function pairFees(fundings: SentFunding[], fees: PaidFee[]): { funding: SentFunding; fee: PaidFee }[] {
  const taken = new Set<string>();
  const out: { funding: SentFunding; fee: PaidFee }[] = [];
  for (const f of [...fundings].sort((a, b) => (a.block === b.block ? a.key.localeCompare(b.key) : a.block < b.block ? -1 : 1))) {
    const owed = feeFor(f.amount);
    // Earlier than the funding first, then an exact 1%, then the fewest transactions of that key in between.
    const rank = (t: PaidFee) => [t.txNonce < f.txNonce ? 0 : 1, t.value === owed ? 0 : 1, Math.abs(t.txNonce - f.txNonce)];
    let best: PaidFee | null = null;
    for (const t of fees) {
      if (taken.has(t.hash) || t.value < owed || t.sender.toLowerCase() !== f.sender.toLowerCase() || t.txNonce === f.txNonce) continue;
      if (!best) best = t;
      else {
        const [a, b] = [rank(t), rank(best)];
        const i = a.findIndex((x, k) => x !== b[k]);
        if (i >= 0 && a[i]! < b[i]!) best = t;
      }
    }
    if (!best) continue; // no fee went with this funding (tabs from before the fee, or a funding sent around Segundo)
    taken.add(best.hash);
    out.push({ funding: f, fee: best });
  }
  return out;
}

/**
 * Splits a tab's refund over the fees it paid: floor(1% of the unspent budget), taken from each paired fee in turn
 * (at most 1% of the funding it paid for), and never more than 1% of the whole budget. Each part is refunded under
 * that fee's own nonce, so the split comes out the same on every retry.
 */
export function splitRefund(owed: bigint, budget: bigint, pairs: { funding: SentFunding; fee: PaidFee }[]): { fee: PaidFee; value: bigint }[] {
  let left = owed < feeFor(budget) ? owed : feeFor(budget);
  const parts: { fee: PaidFee; value: bigint }[] = [];
  for (const { funding, fee } of pairs) {
    if (left === 0n) break;
    const cap = feeFor(funding.amount);
    const value = left < cap ? left : cap;
    parts.push({ fee, value });
    left -= value;
  }
  return parts;
}

/** The client's fee authorisation inside a transaction's input, or null when the input is anything else. */
export function feeAuthorization(input: Hex, payer: Address): { value: bigint; nonce: Hex } | null {
  try {
    const d = decodeFunctionData({ abi: dollarAbi, data: input });
    if (d.functionName !== "transferWithAuthorization") return null;
    const [from, to, value, , , nonce] = d.args;
    if (from.toLowerCase() !== payer.toLowerCase() || to.toLowerCase() !== TREASURY.toLowerCase()) return null;
    return { value, nonce };
  } catch {
    return null;
  }
}

/** The fee transfers from `payer` to the treasury near these fundings, each read back to its own authorisation. */
async function feesNear(payer: Address, fundings: Funding[]): Promise<PaidFee[]> {
  const found = new Map<Hex, { block: bigint; value: bigint }>();
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
        for (const l of logs) if (l.transactionHash) found.set(l.transactionHash, { block: l.blockNumber, value: l.args.value ?? 0n });
      });
    }),
  );
  const fees = await Promise.all(
    [...found].map(async ([hash, t]): Promise<PaidFee | null> => {
      const tx = await publicClient.getTransaction({ hash }).catch(() => null);
      const fee = tx && tx.to?.toLowerCase() === DOLLAR.toLowerCase() ? feeAuthorization(tx.input, payer) : null;
      // A plain transfer, or one whose authorisation doesn't match the log, has no nonce of its own to refund it by.
      if (!tx || !fee || fee.value !== t.value) return null;
      return { hash, block: t.block, value: t.value, sender: tx.from, txNonce: tx.nonce, clientNonce: fee.nonce };
    }),
  );
  return fees.filter((f): f is PaidFee => f !== null);
}

export type TabRefund = { value: bigint; hash?: Hex; block?: number; note?: string; parts?: Refund[] };

/**
 * The fee refund for a closed tab: floor(1% of the unspent budget returned at close), never more than the fees the
 * tab's client actually paid for its fundings, nor 1% of everything the tab was funded with.
 *
 * Each part is refunded under feeRefundNonce(the client's own fee nonce), the same nonce a failed open's refund
 * uses, so AUSD itself lets every fee come back at most once, whichever tab, instance or path asks: one fee can't
 * refund many tabs, and a fee already sent back whole isn't refunded again at close.
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
  // Tabs refunded before refunds went per fee carry the tab's own nonce.
  if (await refunded(tabRefundNonce(id))) return { value: 0n, note: "already refunded" };
  const history = await tabLogs(id, t.lastBlock);
  if (history.refunded === null) throw new Error(`couldn't find tab ${id}'s close`);
  const owed = history.refunded / 100n;
  if (owed === 0n) return { value: 0n, note: "no unspent budget" };
  if (!history.complete) console.warn(`fee refund: tab ${id}'s history was read only in part; refunding against the fees found`);
  const [sent, fees] = await Promise.all([
    Promise.all(
      history.fundings.map(async (f): Promise<SentFunding | null> => {
        const tx = await publicClient.getTransaction({ hash: f.hash }).catch(() => null);
        return tx ? { ...f, sender: tx.from, txNonce: tx.nonce } : null;
      }),
    ),
    feesNear(t.payer, history.fundings),
  ]);
  const parts = splitRefund(owed, t.budget, pairFees(sent.filter((f): f is SentFunding => f !== null), fees)).filter((p) => p.value > 0n);
  if (!parts.length) return { value: 0n, note: "no fee was collected on this tab" };
  const done: Refund[] = [];
  for (const p of parts) {
    const nonce = feeRefundNonce(p.fee.clientNonce);
    if (await refunded(nonce)) continue; // this fee already came back (an earlier try, or its open failed)
    done.push(await fromTreasury(t.payer, p.value, nonce));
  }
  if (!done.length) return { value: 0n, note: "already refunded" };
  const last = done.at(-1)!;
  return { value: done.reduce((s, r) => s + r.value, 0n), hash: last.hash, block: last.block, parts: done };
}

const executedEvent = parseAbiItem("event ExecutedForwardRequest(address indexed signer, uint256 nonce, bool success)");

/**
 * Whether the forward request `from` signed under `nonce`, carrying the Till call `data`, has run: true when it ran
 * (anywhere, a copy sent straight to the forwarder included), false when it certainly didn't, null when that can't
 * be told. Only false lets a collected fee go back. A different call that used the same nonce (two taps at once)
 * counts as not run, since this request can never run now.
 */
export async function requestRan(from: Address, nonce: bigint, data: Hex): Promise<boolean | null> {
  const now = (await publicClient.readContract({ address: FORWARDER, abi: forwarderAbi, functionName: "nonces", args: [from] })) as bigint;
  if (now <= nonce) return false;
  const head = await publicClient.getBlockNumber({ cacheTime: 0 });
  const logs = await publicClient.getLogs({ address: FORWARDER, event: executedEvent, args: { signer: from }, fromBlock: head > SPAN ? head - SPAN : 0n, toBlock: head });
  const ran = logs.find((l) => l.args.nonce === nonce);
  if (!ran?.transactionHash) return null;
  if (!ran.args.success) return false;
  const tx = await publicClient.getTransaction({ hash: ran.transactionHash });
  try {
    const d = decodeFunctionData({ abi: forwarderAbi, data: tx.input });
    if (d.functionName !== "execute") return null;
    const [req] = d.args as unknown as [{ from: Address; data: Hex }];
    return req.from.toLowerCase() === from.toLowerCase() && req.data.toLowerCase() === data.toLowerCase();
  } catch {
    return null; // a batch, or a contract in between: not provably another call
  }
}
