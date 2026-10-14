import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, keccak256, pad, parseAbi, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** The cash-out settlement swap: one swap per cash-out transfer, whichever server instance is asked. */

// A throwaway key made up for this test; it only ever signs against the fake chain below.
const TEST_KEY = pad("0x5e9", { size: 32 }) as Hex;
const h = vi.hoisted(() => ({
  partner: "" as Address,
  receipts: new Map<string, unknown>(),
  txs: new Map<string, { to: Address; input: Hex; from: Address }>(),
  outflows: [] as { transactionHash: Hex; blockNumber: bigint; args: { value: bigint } }[],
  sent: [] as { to: Address; data: Hex }[],
}));
h.partner = privateKeyToAccount(TEST_KEY).address;

vi.mock("@/app/cashout/corridors", () => ({ DEMO_PARTNER: h.partner, AGORA_PAIR: "0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae" }));
vi.mock("@/lib/server", () => ({
  revertReason: (e: unknown) => String(e),
  sendAndWait: async (_c: unknown, tx: { to: Address; data: Hex }) => {
    h.sent.push(tx);
    return { hash: keccak256(tx.data), block: 101, logs: [] };
  },
}));
vi.mock("@/lib/chain", async (original) => ({
  ...(await original<typeof import("@/lib/chain")>()),
  publicClient: {
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      const r = h.receipts.get(hash.toLowerCase());
      if (!r) throw new Error("not found");
      return r;
    },
    getBlock: async () => ({ timestamp: BigInt(Math.floor(Date.now() / 1000)) }),
    getBlockNumber: async () => 120n,
    getLogs: async () => h.outflows,
    getTransaction: async ({ hash }: { hash: Hex }) => h.txs.get(hash.toLowerCase()),
    getBalance: async () => 10n ** 18n,
    readContract: async ({ functionName }: { functionName: string }) =>
      functionName === "hasRole" ? true : functionName === "getAmountsOut" ? [5_000_000n, 5n * 10n ** 18n] : 10n ** 12n,
    call: async () => ({ data: "0x" }),
  },
}));

process.env.PARTNER_KEY = TEST_KEY;
const { settleCashOut, settledBefore, settles, taggedSwap, AGORA_PAIR } = await import("@/lib/settlement");
const { DOLLAR } = await import("@/lib/chain");

let n = 0;
const hash = () => keccak256(toHex(`settle-${++n}`));

/** A landed cash-out: the freelancer's AUSD transfer to the partner. */
function cashOut(value: bigint) {
  const transfer = hash();
  const topics = [keccak256(toHex("Transfer(address,address,uint256)")), pad("0x1234"), pad(h.partner)];
  h.receipts.set(transfer, { status: "success", blockNumber: 100n, logs: [{ address: DOLLAR, topics, data: pad(toHex(value)) }] });
  return transfer;
}

beforeEach(() => {
  h.receipts.clear();
  h.txs.clear();
  h.outflows = [];
  h.sent = [];
});

describe("cash-out settlement", () => {
  it("tags each swap with the cash-out it settles", async () => {
    const transfer = cashOut(5_000_000n);
    const r = await settleCashOut(transfer);
    expect(r).toHaveProperty("settled");
    const swap = h.sent.find((s) => s.to.toLowerCase() === AGORA_PAIR.toLowerCase())!;
    expect(settles(swap.data, transfer)).toBe(true);
    expect(settles(swap.data, hash())).toBe(false);
  });

  it("doesn't swap a cash-out another instance already settled", async () => {
    const transfer = cashOut(5_000_000n);
    const call = encodeFunctionData({ abi: parseAbi(["function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"]), functionName: "swapExactTokensForTokens", args: [5_000_000n, 1n, [], h.partner, 1n] });
    const earlier = hash();
    h.txs.set(earlier, { to: AGORA_PAIR, input: taggedSwap(call, transfer), from: h.partner });
    h.receipts.set(earlier, { status: "success", blockNumber: 102n, logs: [] });
    h.outflows = [{ transactionHash: earlier, blockNumber: 102n, args: { value: 5_000_000n } }];
    expect(await settledBefore(h.partner, transfer, 100n)).toMatchObject({ hash: earlier, ausd: "5000000" });
    const r = await settleCashOut(transfer);
    expect(r).toMatchObject({ settled: { hash: earlier } });
    expect(h.sent).toHaveLength(0);
  });

  it("answers 404 for a transfer that isn't on chain, and lets it be asked again", async () => {
    const missing = hash();
    expect(await settleCashOut(missing)).toMatchObject({ status: 404 });
    h.receipts.set(missing, { status: "success", blockNumber: 100n, logs: [] });
    expect(await settleCashOut(missing)).toMatchObject({ status: 422 }); // landed, but paid someone else
  }, 15_000);

  it("ignores a partner swap tagged with another cash-out", async () => {
    const transfer = cashOut(5_000_000n);
    const other = hash();
    h.txs.set(other, { to: AGORA_PAIR, input: taggedSwap("0x38ed1739", hash()), from: h.partner });
    h.outflows = [{ transactionHash: other, blockNumber: 101n, args: { value: 1n } }];
    expect(await settledBefore(h.partner, transfer, 100n)).toBeNull();
  });
});
