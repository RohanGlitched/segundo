import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, pad, toHex, type Address, type Hex } from "viem";
import { forwarderAbi, tillAbi } from "@/lib/abi";
import { DOLLAR, FORWARDER, TILL, TREASURY, dollarAbi } from "@/lib/chain";

/**
 * A small in-memory stand-in for Monad, Till, the forwarder and AUSD: just the reads the relay and the refunds make,
 * and a `send` that applies the AUSD authorisations and forward requests the relayer submits. No network.
 */

type Tx = { hash: Hex; from: Address; to: Address; nonce: number; input: Hex; block: bigint };
type RawLog = { blockNumber: Hex; transactionHash: Hex; logIndex: Hex; topics: Hex[]; data: Hex; address: Address };
type Transfer = { hash: Hex; block: bigint; logIndex: number; from: Address; to: Address; value: bigint };
type Executed = { hash: Hex; block: bigint; signer: Address; nonce: bigint; success: boolean };
export type FakeTab = { payer: Address; payee: Address; rate: bigint; held: boolean; closed: boolean; lastBlock: bigint; budget: bigint; owed: bigint };

export const PAYER: Address = "0x1111111111111111111111111111111111111111";
export const PAYEE: Address = "0x2222222222222222222222222222222222222222";
export const RELAYER: Address = "0x3333333333333333333333333333333333333333";
export const SIG: Hex = `0x${"11".repeat(32)}${"22".repeat(32)}1b`;

const lower = (a: string) => a.toLowerCase();
let seq = 0;
export const txHash = () => keccak256(toHex(`tx-${++seq}`));
export const randomNonce = () => keccak256(toHex(`nonce-${++seq}`));

export class FakeChain {
  head = 5_000n;
  txs = new Map<string, Tx>();
  tillLogs: RawLog[] = [];
  transfers: Transfer[] = [];
  executed: Executed[] = [];
  used = new Set<string>();
  tabs = new Map<bigint, FakeTab>();
  profiles = new Map<string, { name: string; place: string; currency: Hex }>();
  fwdNonces = new Map<string, bigint>();
  senderNonces = new Map<string, number>();
  verify = true;
  /** AUSD balances that differ from the default (plenty), by lower-cased address. */
  balances = new Map<string, bigint>();
  /** Transactions the relayer sent, in order. */
  sent: { to: Address; data: Hex }[] = [];

  authorizationUsed = (authorizer: Address, nonce: Hex) => this.used.has(`${lower(authorizer)}:${lower(nonce)}`);

  /** Records a transaction from `from` at its next nonce, in the current head block. */
  addTx(from: Address, to: Address, input: Hex, block = this.head): Tx {
    const nonce = this.senderNonces.get(lower(from)) ?? 0;
    this.senderNonces.set(lower(from), nonce + 1);
    const tx = { hash: txHash(), from, to, nonce, input, block };
    this.txs.set(lower(tx.hash), tx);
    return tx;
  }

  /** A client's fee authorisation to the treasury, submitted by `sender`. */
  payFee(payer: Address, value: bigint, sender: Address, block = this.head, clientNonce = randomNonce()) {
    const input = encodeFunctionData({ abi: dollarAbi, functionName: "transferWithAuthorization", args: [payer, TREASURY, value, 0n, 9_999_999_999n, clientNonce, 27, pad("0x11"), pad("0x22")] });
    const tx = this.addTx(sender, DOLLAR, input, block);
    this.used.add(`${lower(payer)}:${lower(clientNonce)}`);
    this.transfers.push({ hash: tx.hash, block, logIndex: 1, from: payer, to: TREASURY, value });
    return { tx, clientNonce };
  }

  private tillLog(hash: Hex, block: bigint, logIndex: number, eventName: string, indexed: Record<string, unknown>, types: { type: string }[], values: unknown[]) {
    const topics = encodeEventTopics({ abi: tillAbi, eventName, args: indexed } as never) as Hex[];
    this.tillLogs.push({ blockNumber: toHex(block), transactionHash: hash, logIndex: toHex(logIndex), topics, data: encodeAbiParameters(types as never, values as never), address: TILL });
  }

  /** A tab opened by a transaction from `sender` (the relayer through the forwarder, or the payer straight on Till). */
  open(id: bigint, budget: bigint, sender: Address, block = this.head, payer = PAYER) {
    const input = encodeFunctionData({ abi: tillAbi, functionName: "open", args: [PAYEE, "0x0000000000000000000000000000000000000000", 3_600_000_000n, budget, "test"] });
    const tx = this.addTx(sender, lower(sender) === lower(payer) ? TILL : FORWARDER, input, block);
    this.tillLog(tx.hash, block, 0, "Opened", { id, payer, payee: PAYEE }, [{ type: "uint64" }, { type: "uint128" }, { type: "address" }, { type: "string" }], [3_600_000_000n, budget, "0x0000000000000000000000000000000000000000", "test"]);
    this.tillLog(tx.hash, block, 1, "Activity", { id }, [{ type: "uint64" }], [0n]);
    this.tabs.set(id, { payer, payee: PAYEE, rate: 3_600_000_000n, held: false, closed: false, lastBlock: block, budget, owed: 0n });
    return tx;
  }

  /** Adds `amount` to a tab's budget, sent by `sender`. */
  topUp(id: bigint, amount: bigint, sender: Address, block = this.head) {
    const t = this.tabs.get(id)!;
    const input = encodeFunctionData({ abi: tillAbi, functionName: "topUp", args: [id, amount] });
    const tx = this.addTx(sender, lower(sender) === lower(t.payer) ? TILL : FORWARDER, input, block);
    t.budget += amount;
    this.tillLog(tx.hash, block, 0, "ToppedUp", { id }, [{ type: "uint128" }, { type: "uint128" }], [amount, t.budget]);
    this.tillLog(tx.hash, block, 1, "Activity", { id }, [{ type: "uint64" }], [t.lastBlock]);
    t.lastBlock = block;
    return tx;
  }

  /** Closes a tab, returning `refunded` of its budget to the payer. */
  close(id: bigint, refunded: bigint) {
    const t = this.tabs.get(id)!;
    // Till links a tab's blocks with one Activity each; a close lands in a later block than the tab's last one.
    if (this.head <= t.lastBlock) this.head = t.lastBlock + 1n;
    const block = this.head;
    const tx = this.addTx(RELAYER, FORWARDER, "0x", block);
    this.tillLog(tx.hash, block, 0, "Closed", { id }, [{ type: "uint128" }, { type: "uint128" }], [t.budget - refunded, refunded]);
    this.tillLog(tx.hash, block, 1, "Activity", { id }, [{ type: "uint64" }], [t.lastBlock]);
    t.closed = true;
    t.lastBlock = block;
  }

  /** The signer's request runs through the forwarder, sent by `sender` (someone other than Segundo's relayer, say). */
  execute(sender: Address, request: { from: Address; to: Address; gas: bigint; deadline: number; data: Hex; signature: Hex }, success = true) {
    const input = encodeFunctionData({ abi: forwarderAbi, functionName: "execute", args: [{ ...request, value: 0n }] });
    const tx = this.addTx(sender, FORWARDER, input);
    const nonce = this.fwdNonces.get(lower(request.from)) ?? 0n;
    this.fwdNonces.set(lower(request.from), nonce + 1n);
    this.executed.push({ hash: tx.hash, block: tx.block, signer: request.from, nonce, success });
    return tx;
  }

  /** What the relayer's sendAndWait does here: AUSD authorisations move money and burn their nonce. */
  send(to: Address, data: Hex) {
    this.sent.push({ to, data });
    if (lower(to) === lower(DOLLAR)) {
      const d = decodeFunctionData({ abi: dollarAbi, data });
      if (d.functionName !== "transferWithAuthorization") throw new Error("unexpected AUSD call");
      const [from, dest, value, , , nonce] = d.args;
      if (this.authorizationUsed(from, nonce)) throw new Error("FiatTokenV2: authorization is used or canceled");
      const tx = this.addTx(RELAYER, DOLLAR, data);
      this.used.add(`${lower(from)}:${lower(nonce)}`);
      this.transfers.push({ hash: tx.hash, block: tx.block, logIndex: 1, from, to: dest, value });
      this.head += 1n;
      return { hash: tx.hash, block: Number(tx.block), logs: [] };
    }
    throw new Error(`unexpected send to ${to}`);
  }

  /** Refunds the treasury has paid to `to`, in base units. */
  refundsTo(to: Address) {
    return this.refundsFrom(TREASURY, to);
  }

  /** AUSD that `from` (the treasury, or the Privy refund wallet) has paid to `to`, in base units. */
  refundsFrom(from: Address, to: Address) {
    return this.transfers.filter((t) => lower(t.from) === lower(from) && lower(t.to) === lower(to)).reduce((s, t) => s + t.value, 0n);
  }

  client = {
    readContract: async ({ functionName, args, address }: { functionName: string; args?: readonly unknown[]; address: Address }) => {
      switch (functionName) {
        case "getTab": {
          const t = this.tabs.get(args![0] as bigint);
          const zero = "0x0000000000000000000000000000000000000000";
          return t ? { id: args![0], tab: t, owed: t.owed, earned: 0n, runway: 0n } : { id: args![0], tab: { payer: zero, closed: false, lastBlock: 0n, budget: 0n }, owed: 0n };
        }
        case "authorizationState":
          return this.authorizationUsed(args![0] as Address, args![1] as Hex);
        case "nonces":
          return lower(address) === lower(FORWARDER) ? (this.fwdNonces.get(lower(args![0] as string)) ?? 0n) : 0n;
        case "verify":
          return this.verify;
        case "balanceOf":
          return this.balances.get(lower(args![0] as string)) ?? 1_000_000_000_000n;
        case "profileOf":
          return this.profiles.get(lower(args![0] as string)) ?? { name: "", place: "", currency: "0x000000" };
        default:
          throw new Error(`fake chain: no ${functionName}`);
      }
    },
    getBlockNumber: async () => this.head,
    estimateGas: async () => 100_000n,
    getTransaction: async ({ hash }: { hash: Hex }) => {
      const tx = this.txs.get(lower(hash));
      if (!tx) throw new Error("transaction not found");
      return tx;
    },
    getLogs: async ({ event, args, fromBlock, toBlock }: { event: { name: string }; args: Record<string, string>; fromBlock: bigint; toBlock: bigint }) => {
      const inRange = (b: bigint) => b >= fromBlock && b <= toBlock;
      if (event.name === "Transfer")
        return this.transfers
          .filter((t) => inRange(t.block) && (!args.from || lower(t.from) === lower(args.from)) && (!args.to || lower(t.to) === lower(args.to)))
          .map((t) => ({ transactionHash: t.hash, blockNumber: t.block, logIndex: t.logIndex, args: { from: t.from, to: t.to, value: t.value } }));
      if (event.name === "ExecutedForwardRequest")
        return this.executed
          .filter((e) => inRange(e.block) && lower(e.signer) === lower(args.signer))
          .map((e) => ({ transactionHash: e.hash, blockNumber: e.block, logIndex: 0, args: { signer: e.signer, nonce: e.nonce, success: e.success } }));
      throw new Error(`fake chain: no logs for ${event.name}`);
    },
    request: async ({ method, params }: { method: string; params: [{ fromBlock: Hex; toBlock: Hex; topics: [Hex[], Hex] }] }) => {
      if (method !== "eth_getLogs") throw new Error(`fake chain: no ${method}`);
      const [{ fromBlock, toBlock, topics }] = params;
      return this.tillLogs.filter((l) => BigInt(l.blockNumber) >= BigInt(fromBlock) && BigInt(l.blockNumber) <= BigInt(toBlock) && lower(l.topics[1]!) === lower(topics[1]));
    },
  };
}

/** A signed fee authorisation as the browser sends it. */
export const signedFee = (value: bigint, nonce = randomNonce(), from: Address = PAYER, to: Address = TREASURY) => ({
  from,
  to,
  value: value.toString(),
  validBefore: String(Math.floor(Date.now() / 1000) + 1800),
  nonce,
  signature: SIG,
});

/** The treasury's refund authorisation, as the mocked authorize() returns it (the signature is never checked here). */
export const treasuryAuthorization = (to: Address, value: bigint, nonce: Hex) => ({
  from: TREASURY,
  to,
  value: value.toString(),
  validBefore: "9999999999",
  nonce,
  signature: SIG,
});
