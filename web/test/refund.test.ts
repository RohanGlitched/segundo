import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FakeChain, PAYER, RELAYER, treasuryAuthorization } from "./fake-chain";

const h = vi.hoisted(() => ({
  chain: null as unknown as import("./fake-chain").FakeChain,
  /** The Privy refund wallet this test runs with, or null for a deployment without it. */
  privy: null as { id: string; address: Address } | null,
  /** What the stand-in for Privy was asked to sign. */
  asked: [] as { value: bigint; to: Address }[],
  /** Privy answers with a refusal (down, or the policy says no). */
  refuse: false,
}));
/** Stands in for the key Privy holds for the refund wallet: signatures are real, so refund.ts's own check runs. */
const PRIVY_KEY = vi.hoisted(() => `0x${"5a".repeat(32)}` as const);

vi.mock("@/lib/chain", async (original) => ({ ...(await original<typeof import("@/lib/chain")>()), publicClient: new Proxy({}, { get: (_, k) => (h.chain.client as never)[k] }) }));
vi.mock("@/lib/envio", () => ({ ledger: async () => ({ source: "rpc", head: 0n, events: [] }) }));
vi.mock("@/lib/authorization", async (original) => ({
  ...(await original<typeof import("@/lib/authorization")>()),
  authorize: async (_account: unknown, to: Address, value: bigint, nonce: Hex) => treasuryAuthorization(to, value, nonce),
}));
vi.mock("@/lib/privy-server", async () => {
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(PRIVY_KEY);
  return {
    REFUND_WALLET_CAP: 50_000_000n,
    refundWallet: async () => h.privy,
    // Privy's policy, as configured: AUSD on chain 10143, at most 50 AUSD; anything else is refused.
    privySignTypedData: async (_id: string, t: { domain: Record<string, unknown>; types: Record<string, unknown>; message: Record<string, string>; primaryType: string }) => {
      const value = BigInt(t.message.value!);
      h.asked.push({ value, to: t.message.to as Address });
      if (h.refuse) throw new Error("Privy refused to sign (503).");
      if (t.domain.chainId !== 10143 || value > 50_000_000n || t.primaryType !== "TransferWithAuthorization") throw new Error("Privy refused to sign (400 policy_violation).");
      const { EIP712Domain: _d, ...types } = t.types;
      const m = t.message;
      const typed = { domain: t.domain, types, primaryType: t.primaryType, message: { ...m, value, validAfter: BigInt(m.validAfter!), validBefore: BigInt(m.validBefore!) } };
      return account.signTypedData(typed as unknown as Parameters<typeof account.signTypedData>[0]);
    },
  };
});
vi.mock("@/lib/server", () => ({
  signer: () => ({ account: { address: RELAYER } }),
  sendAndWait: async (_client: unknown, tx: { to: Address; data: Hex }) => h.chain.send(tx.to, tx.data),
}));

const { PAST_REFUND_SIGNERS, REFILL, feeAuthorization, feeRefundNonce, fromTreasury, pairFees, refundClosedTab, splitRefund, tabRefundNonce } = await import("@/lib/refund");
const { TREASURY } = await import("@/lib/chain");
const PRIVY_WALLET = privateKeyToAccount(PRIVY_KEY).address;

const BUDGET = 10_000_000n; // $10
const FEE = 100_000n; // its 1%
const STRANGER: Address = "0x4444444444444444444444444444444444444444";

beforeEach(() => {
  h.chain = new FakeChain();
  h.privy = null;
  h.asked = [];
  h.refuse = false;
});

/** A tab opened the way the relay does it: the fee from the relayer key, then the open from the same key. */
function relayedTab(id: bigint, budget = BUDGET) {
  const fee = h.chain.payFee(PAYER, (budget + 99n) / 100n, RELAYER);
  h.chain.head += 1n;
  const open = h.chain.open(id, budget, RELAYER);
  h.chain.head += 1n;
  return { fee, open };
}

describe("close-time fee refunds", () => {
  it("refunds 1% of the unspent budget of a tab that paid its fee, once", async () => {
    relayedTab(1n);
    h.chain.close(1n, BUDGET);
    const first = await refundClosedTab(1n);
    expect(first.value).toBe(FEE);
    expect(h.chain.refundsTo(PAYER)).toBe(FEE);
    const again = await refundClosedTab(1n);
    expect(again).toMatchObject({ value: 0n, note: "already refunded" });
    expect(h.chain.refundsTo(PAYER)).toBe(FEE);
  });

  it("refunds only what wasn't spent", async () => {
    relayedTab(1n);
    h.chain.close(1n, 2_500_000n);
    expect((await refundClosedTab(1n)).value).toBe(25_000n);
  });

  it("exploit: one fee can't refund many fee-less tabs opened straight on Till", async () => {
    relayedTab(1n);
    // Tabs funded within the same minute, sent by the client itself: no fee went with them.
    for (const id of [2n, 3n, 4n]) {
      h.chain.open(id, BUDGET, PAYER);
      h.chain.head += 1n;
    }
    for (const id of [2n, 3n, 4n, 1n]) h.chain.close(id, BUDGET);
    for (const id of [2n, 3n, 4n]) expect(await refundClosedTab(id)).toMatchObject({ value: 0n, note: "no fee was collected on this tab" });
    expect((await refundClosedTab(1n)).value).toBe(FEE);
    expect(h.chain.refundsTo(PAYER)).toBe(FEE);
  });

  it("exploit: two tabs, one fee: the second refund is 0", async () => {
    // Two fundings from the relayer key, only one fee between them (as if one had slipped past the fee).
    relayedTab(1n);
    h.chain.open(2n, BUDGET, RELAYER);
    h.chain.close(1n, BUDGET);
    h.chain.close(2n, BUDGET);
    const a = await refundClosedTab(2n);
    const b = await refundClosedTab(1n);
    expect(a.value + b.value).toBe(FEE);
    expect([a.note, b.note]).toContain("already refunded");
    expect(h.chain.refundsTo(PAYER)).toBe(FEE);
  });

  it("exploit: a request sent straight to the forwarder by the client pairs with no fee", async () => {
    // The relay collected a fee, then the client ran the same request with its own gas.
    h.chain.payFee(PAYER, FEE, RELAYER);
    h.chain.head += 1n;
    h.chain.open(1n, BUDGET, STRANGER);
    h.chain.close(1n, BUDGET);
    expect((await refundClosedTab(1n)).value).toBe(0n);
  });

  it("a fee already sent back whole (failed open) isn't refunded again at close", async () => {
    const { fee } = relayedTab(1n);
    h.chain.used.add(`${TREASURY.toLowerCase()}:${feeRefundNonce(fee.clientNonce).toLowerCase()}`);
    h.chain.close(1n, BUDGET);
    expect(await refundClosedTab(1n)).toMatchObject({ value: 0n, note: "already refunded" });
    expect(h.chain.refundsTo(PAYER)).toBe(0n);
  });

  it("a tab refunded under the old per-tab nonce isn't refunded again", async () => {
    relayedTab(1n);
    h.chain.close(1n, BUDGET);
    h.chain.used.add(`${TREASURY.toLowerCase()}:${tabRefundNonce(1n).toLowerCase()}`);
    expect(await refundClosedTab(1n)).toMatchObject({ value: 0n, note: "already refunded" });
  });

  it("a top-up's fee is refunded under its own nonce, and a retry sends only what is missing", async () => {
    relayedTab(1n);
    const topUpFee = h.chain.payFee(PAYER, FEE, RELAYER);
    h.chain.head += 1n;
    h.chain.topUp(1n, BUDGET, RELAYER);
    h.chain.head += 1n;
    h.chain.close(1n, 2n * BUDGET);
    // The second part went before (say the first try stopped halfway).
    h.chain.used.add(`${TREASURY.toLowerCase()}:${feeRefundNonce(topUpFee.clientNonce).toLowerCase()}`);
    const r = await refundClosedTab(1n);
    expect(r.value).toBe(FEE);
    expect(r.parts).toHaveLength(1);
  });

  it("refuses a tab that is still open", async () => {
    relayedTab(1n);
    await expect(refundClosedTab(1n)).rejects.toThrow(/still open/);
  });

  it("tabRefundNonce and feeRefundNonce are fixed per tab and per fee", () => {
    expect(tabRefundNonce(7n)).toBe(tabRefundNonce(7n));
    expect(tabRefundNonce(7n)).not.toBe(tabRefundNonce(8n));
    const n = `0x${"ab".repeat(32)}` as Hex;
    expect(feeRefundNonce(n)).toBe(feeRefundNonce(n));
    expect(feeRefundNonce(n)).not.toBe(feeRefundNonce(`0x${"ac".repeat(32)}`));
  });
});

describe("pairFees", () => {
  const funding = (key: string, sender: Address, txNonce: number, amount = BUDGET, block = 100n) => ({ key, hash: key as Hex, block, amount, sender, txNonce });
  const fee = (hash: string, sender: Address, txNonce: number, value = FEE, block = 99n) => ({ hash: hash as Hex, block, value, sender, txNonce, clientNonce: hash as Hex });

  it("pairs a funding with the fee its own key sent just before it", () => {
    const pairs = pairFees([funding("0xa", RELAYER, 11)], [fee("0xf1", RELAYER, 3), fee("0xf2", RELAYER, 10), fee("0xf3", RELAYER, 12)]);
    expect(pairs.map((p) => p.fee.hash)).toEqual(["0xf2"]);
  });

  it("uses each fee once within a tab", () => {
    const pairs = pairFees([funding("0xa", RELAYER, 11), funding("0xb", RELAYER, 12, BUDGET, 101n)], [fee("0xf", RELAYER, 10)]);
    expect(pairs).toHaveLength(1);
  });

  it("ignores fees sent by another account, and fees under 1%", () => {
    expect(pairFees([funding("0xa", PAYER, 0)], [fee("0xf", RELAYER, 10)])).toHaveLength(0);
    expect(pairFees([funding("0xa", RELAYER, 11)], [fee("0xf", RELAYER, 10, FEE - 1n)])).toHaveLength(0);
  });

  it("falls back to a fee sent just after (the demo studios' order)", () => {
    expect(pairFees([funding("0xa", RELAYER, 11)], [fee("0xf", RELAYER, 12)])).toHaveLength(1);
  });
});

describe("splitRefund", () => {
  const pair = (amount: bigint) => ({
    funding: { key: "k", hash: "0x" as Hex, block: 1n, amount, sender: RELAYER, txNonce: 1 },
    fee: { hash: "0x" as Hex, block: 1n, value: (amount + 99n) / 100n, sender: RELAYER, txNonce: 0, clientNonce: "0x" as Hex },
  });
  it("never pays more than 1% of each funding, nor 1% of the budget", () => {
    expect(splitRefund(1_000n, BUDGET, [pair(BUDGET)]).map((p) => p.value)).toEqual([1_000n]);
    expect(splitRefund(FEE * 5n, BUDGET, [pair(BUDGET)]).map((p) => p.value)).toEqual([FEE]);
    expect(splitRefund(150_000n, 2n * BUDGET, [pair(BUDGET), pair(BUDGET)]).map((p) => p.value)).toEqual([FEE, 50_000n]);
  });
});

describe("feeAuthorization", () => {
  it("reads the client's nonce from a fee transfer to the treasury, and nothing else", () => {
    const { tx, clientNonce } = h.chain.payFee(PAYER, FEE, RELAYER);
    expect(feeAuthorization(tx.input, PAYER)).toEqual({ value: FEE, nonce: clientNonce });
    expect(feeAuthorization(tx.input, STRANGER)).toBeNull();
    expect(feeAuthorization("0xdeadbeef", PAYER)).toBeNull();
  });
});

describe("refunds from the Privy server wallet", () => {
  beforeEach(() => {
    h.privy = { id: "refund-wallet", address: PRIVY_WALLET };
  });
  const used = (signer: Address, nonce: Hex) => h.chain.used.add(`${signer.toLowerCase()}:${nonce.toLowerCase()}`);

  it("a close refund is signed by the Privy wallet, submitted by the relayer, and paid once", async () => {
    relayedTab(1n);
    h.chain.close(1n, BUDGET);
    const first = await refundClosedTab(1n);
    expect(first.value).toBe(FEE);
    expect(first.parts?.[0]?.from).toBe(PRIVY_WALLET);
    expect(h.chain.refundsFrom(PRIVY_WALLET, PAYER)).toBe(FEE);
    expect(h.chain.refundsTo(PAYER)).toBe(0n); // nothing from the treasury
    expect(await refundClosedTab(1n)).toMatchObject({ value: 0n, note: "already refunded" });
    expect(h.chain.refundsFrom(PRIVY_WALLET, PAYER)).toBe(FEE);
  });

  it("a fee the treasury already refunded isn't refunded again by the Privy wallet", async () => {
    const { fee } = relayedTab(1n);
    used(TREASURY, feeRefundNonce(fee.clientNonce));
    h.chain.close(1n, BUDGET);
    expect(await refundClosedTab(1n)).toMatchObject({ value: 0n, note: "already refunded" });
    expect(h.asked).toHaveLength(0);
  });

  it("a fee the Privy wallet refunded stays refunded on a deployment without it", async () => {
    const { fee } = relayedTab(1n);
    // The real refund wallet's address is in the code, not only in env.
    used(PAST_REFUND_SIGNERS[1]!, feeRefundNonce(fee.clientNonce));
    h.privy = null;
    h.chain.close(1n, BUDGET);
    expect(await refundClosedTab(1n)).toMatchObject({ value: 0n, note: "already refunded" });
    expect(h.chain.refundsTo(PAYER)).toBe(0n);
  });

  it("a failed open's whole fee goes back from the Privy wallet under the fee's own nonce", async () => {
    const nonce = feeRefundNonce(`0x${"cd".repeat(32)}`);
    const r = await fromTreasury(PAYER, FEE, nonce);
    expect(r.from).toBe(PRIVY_WALLET);
    expect(h.chain.authorizationUsed(PRIVY_WALLET, nonce)).toBe(true);
    await expect(fromTreasury(PAYER, FEE, nonce)).rejects.toThrow(/authorization is used/);
    expect(h.chain.refundsFrom(PRIVY_WALLET, PAYER)).toBe(FEE);
  });

  it("over the policy's 50 AUSD cap, the treasury signs instead (decided by the amount, never by a failure)", async () => {
    const big = 6_000_000_000n; // a $6,000 tab: its 1% fee is $60
    relayedTab(1n, big);
    h.chain.close(1n, big);
    const r = await refundClosedTab(1n);
    expect(r.value).toBe(60_000_000n);
    expect(r.parts?.[0]?.from).toBe(TREASURY);
    expect(h.asked).toHaveLength(0);
    expect(h.chain.refundsTo(PAYER)).toBe(60_000_000n);
  });

  it("when the float is short, the treasury tops the Privy wallet up first", async () => {
    h.chain.balances.set(PRIVY_WALLET.toLowerCase(), 0n);
    relayedTab(1n);
    h.chain.close(1n, BUDGET);
    expect((await refundClosedTab(1n)).value).toBe(FEE);
    expect(h.chain.refundsFrom(TREASURY, PRIVY_WALLET)).toBe(REFILL);
    expect(h.chain.refundsFrom(PRIVY_WALLET, PAYER)).toBe(FEE);
  });

  it("if Privy refuses, nothing is sent and the treasury doesn't step in (a retry asks Privy again)", async () => {
    h.refuse = true;
    relayedTab(1n);
    h.chain.close(1n, BUDGET);
    await expect(refundClosedTab(1n)).rejects.toThrow(/Privy refused/);
    expect(h.chain.sent).toHaveLength(0);
    h.refuse = false;
    expect((await refundClosedTab(1n)).value).toBe(FEE);
    expect(h.chain.refundsFrom(PRIVY_WALLET, PAYER)).toBe(FEE);
    expect(h.chain.refundsTo(PAYER)).toBe(0n);
  });

  it("a signature that isn't the wallet's is never submitted", async () => {
    h.privy = { id: "refund-wallet", address: STRANGER }; // Privy answers with a key that isn't this wallet's
    relayedTab(1n);
    h.chain.close(1n, BUDGET);
    await expect(refundClosedTab(1n)).rejects.toThrow(/didn't check out/);
    expect(h.chain.sent).toHaveLength(0);
    expect(h.chain.refundsTo(PAYER)).toBe(0n);
  });
});
