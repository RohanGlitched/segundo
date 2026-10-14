import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, toHex, type Address, type Hex } from "viem";
import { FakeChain, PAYER, RELAYER, SIG, randomNonce, signedFee, treasuryAuthorization } from "./fake-chain";

/**
 * The relay route end to end against the fake chain: what it refuses before anything is sent, and when a fee it
 * collected may go back.
 */

const h = vi.hoisted(() => ({
  chain: null as unknown as import("./fake-chain").FakeChain,
  /** Called for each forward request the relayer sends; throws to make the send fail. */
  onExecute: (() => undefined) as () => void,
  /** Resolves the fee send, when a test wants to hold it in flight. */
  holdFee: null as Promise<void> | null,
  feeStarted: false,
}));

vi.mock("@/lib/chain", async (original) => ({ ...(await original<typeof import("@/lib/chain")>()), publicClient: new Proxy({}, { get: (_, k) => (h.chain.client as never)[k] }) }));
vi.mock("@/lib/envio", () => ({ ledger: async () => ({ source: "rpc", head: 0n, events: [] }) }));
vi.mock("@/lib/authorization", async (original) => ({
  ...(await original<typeof import("@/lib/authorization")>()),
  authorize: async (_account: unknown, to: Address, value: bigint, nonce: Hex) => treasuryAuthorization(to, value, nonce),
}));
vi.mock("@/lib/server", async (original) => {
  const real = await original<typeof import("@/lib/server")>();
  const { FORWARDER } = await import("@/lib/chain");
  return {
    ...real,
    signer: () => ({ account: { address: RELAYER } }),
    relayerFor: async () => ({ relayer: { account: { address: RELAYER } }, low: null }),
    asRelayer: (_key: unknown, fn: () => Promise<unknown>) => fn(),
    sendAndWait: async (_client: unknown, tx: { to: Address; data: Hex }) => {
      if (tx.to.toLowerCase() === FORWARDER.toLowerCase()) {
        h.chain.sent.push(tx);
        h.onExecute();
        return { hash: toHex(1, { size: 32 }), block: Number(h.chain.head), logs: [] };
      }
      h.feeStarted = true;
      if (h.holdFee) await h.holdFee;
      return h.chain.send(tx.to, tx.data);
    },
  };
});

const { POST } = await import("@/app/api/relay/route");
const { tillAbi } = await import("@/lib/abi");
const { DOLLAR, FORWARDER, TILL, TREASURY } = await import("@/lib/chain");
const { feeRefundNonce } = await import("@/lib/refund");

const BUDGET = 10_000_000n;
const FEE = 100_000n;
const PAYEE: Address = "0x2222222222222222222222222222222222222222";
const ZERO: Address = "0x0000000000000000000000000000000000000000";
let ip = 0;
// The route's pace limits live in memory for the whole file: each test runs a few minutes after the last.
let clock = Date.now();

beforeEach(() => {
  h.chain = new FakeChain();
  h.onExecute = () => undefined;
  h.holdFee = null;
  h.feeStarted = false;
  clock += 5 * 60_000;
  vi.setSystemTime(clock);
});

const openData = (budget = BUDGET) => encodeFunctionData({ abi: tillAbi, functionName: "open", args: [PAYEE, ZERO, 3_600_000_000n, budget, "test"] });

function request(data: Hex, nonce = h.chain.fwdNonces.get(PAYER.toLowerCase()) ?? 0n) {
  // A fresh signature per request: the route keys requests in flight by their signature.
  const signature = `0x${randomNonce().slice(2)}${"22".repeat(32)}1b` as Hex;
  return { from: PAYER, to: TILL, value: "0", gas: "150000", nonce: nonce.toString(), deadline: Math.floor(Date.now() / 1000) + 600, data, signature };
}

/** POSTs to the relay from its own IP address, so the per-IP pace never decides a test. */
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/relay", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": `10.0.0.${++ip}` }, body: JSON.stringify(body) }));

const sentTo = (to: Address) => h.chain.sent.filter((s) => s.to.toLowerCase() === to.toLowerCase()).length;

describe("relay: fees", () => {
  it("refuses a fee under 1%", async () => {
    const res = await post({ request: request(openData()), fee: signedFee(FEE - 1n) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/1% fee/);
    expect(h.chain.sent).toHaveLength(0);
  });

  it("refuses a fee from someone other than the signer, or to anyone but the treasury", async () => {
    const other: Address = "0x5555555555555555555555555555555555555555";
    expect((await post({ request: request(openData()), fee: signedFee(FEE, randomNonce(), other) })).status).toBe(400);
    expect((await post({ request: request(openData()), fee: signedFee(FEE, randomNonce(), PAYER, other) })).status).toBe(400);
    expect(h.chain.sent).toHaveLength(0);
  });

  it("refuses an open with no fee", async () => {
    expect((await post({ request: request(openData()) })).status).toBe(400);
  });

  it("collects the fee first, then sends the open", async () => {
    const res = await post({ request: request(openData()), fee: signedFee(FEE) });
    expect(res.status).toBe(200);
    expect(h.chain.sent.map((s) => s.to.toLowerCase())).toEqual([DOLLAR.toLowerCase(), FORWARDER.toLowerCase()]);
  });

  it("answers 409 to a second copy of a request already on its way", async () => {
    let release!: () => void;
    h.holdFee = new Promise((r) => (release = r));
    const body = { request: request(openData()), fee: signedFee(FEE) };
    const first = post(body);
    // The copy arrives while the first request's fee is being sent.
    await vi.waitFor(() => expect(h.feeStarted).toBe(true));
    const second = await post(body);
    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    expect(sentTo(FORWARDER)).toBe(1);
  });

  it("refuses a request whose stated nonce isn't the one it can run under", async () => {
    h.chain.fwdNonces.set(PAYER.toLowerCase(), 4n);
    expect((await post({ request: request(openData(), 3n), fee: signedFee(FEE) })).status).toBe(400);
    expect(h.chain.sent).toHaveLength(0);
  });
});

describe("relay: a failed open after its fee landed", () => {
  it("sends the whole fee back when the request didn't run", async () => {
    h.onExecute = () => {
      throw new Error("Monad rejected the transaction.");
    };
    const fee = signedFee(FEE);
    const res = await post({ request: request(openData()), fee });
    expect(res.status).toBe(502);
    expect(h.chain.refundsTo(PAYER)).toBe(FEE);
    // Under the fee's own refund nonce, so a later close can't refund it again.
    expect(h.chain.authorizationUsed(TREASURY, feeRefundNonce(fee.nonce))).toBe(true);
  });

  it("exploit: keeps the fee when the client ran the same signed request straight through the forwarder", async () => {
    const req = request(openData());
    // The relay's own send fails because the client's copy used the nonce first.
    h.onExecute = () => {
      h.chain.execute(PAYER, { from: PAYER, to: TILL, gas: 150_000n, deadline: req.deadline, data: req.data, signature: req.signature });
      throw new Error("ERC2771ForwarderInvalidSigner");
    };
    const res = await post({ request: req, fee: signedFee(FEE) });
    expect(res.status).toBe(409);
    expect(h.chain.refundsTo(PAYER)).toBe(0n);
  });

  it("keeps the fee when the nonce moved and what ran can't be told", async () => {
    h.onExecute = () => {
      h.chain.fwdNonces.set(PAYER.toLowerCase(), 1n); // ran, but its log isn't to be found
      throw new Error("ERC2771ForwarderInvalidSigner");
    };
    const res = await post({ request: request(openData()), fee: signedFee(FEE) });
    expect(res.status).toBe(502);
    expect(h.chain.refundsTo(PAYER)).toBe(0n);
  });

  it("sends the fee back when a different call took the nonce (two taps at once)", async () => {
    const req = request(openData());
    h.onExecute = () => {
      const hold = encodeFunctionData({ abi: tillAbi, functionName: "hold", args: [9n, true] });
      h.chain.execute(RELAYER, { from: PAYER, to: TILL, gas: 90_000n, deadline: req.deadline, data: hold, signature: SIG });
      throw new Error("ERC2771ForwarderInvalidSigner");
    };
    const res = await post({ request: req, fee: signedFee(FEE) });
    expect(res.status).toBe(502);
    expect(h.chain.refundsTo(PAYER)).toBe(FEE);
  });
});

describe("relay: calls that change nothing", () => {
  const tab = () => h.chain.open(7n, BUDGET, RELAYER);

  it("refuses a hold to the state the tab is already in", async () => {
    tab();
    const res = await post({ request: request(encodeFunctionData({ abi: tillAbi, functionName: "hold", args: [7n, false] })) });
    expect(res.status).toBe(409);
    expect(h.chain.sent).toHaveLength(0);
    h.chain.tabs.get(7n)!.held = true;
    expect((await post({ request: request(encodeFunctionData({ abi: tillAbi, functionName: "hold", args: [7n, false] })) })).status).toBe(200);
  });

  it("refuses a payout with nothing owed", async () => {
    tab();
    expect((await post({ request: request(encodeFunctionData({ abi: tillAbi, functionName: "settle", args: [7n] })) })).status).toBe(409);
    h.chain.tabs.get(7n)!.owed = 1n;
    expect((await post({ request: request(encodeFunctionData({ abi: tillAbi, functionName: "settle", args: [7n] })) })).status).toBe(200);
  });

  it("refuses the profile already set", async () => {
    h.chain.profiles.set(PAYER.toLowerCase(), { name: "Ada", place: "Lagos", currency: "0x4e474e" });
    expect((await post({ request: request(encodeFunctionData({ abi: tillAbi, functionName: "setProfile", args: ["Ada", "Lagos", "0x4e474e"] })) })).status).toBe(409);
    expect((await post({ request: request(encodeFunctionData({ abi: tillAbi, functionName: "setProfile", args: ["Ada", "Abuja", "0x4e474e"] })) })).status).toBe(200);
  });

  it("paces free calls on one tab", async () => {
    tab();
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) {
      h.chain.tabs.get(7n)!.held = i % 2 === 1;
      statuses.push((await post({ request: request(encodeFunctionData({ abi: tillAbi, functionName: "hold", args: [7n, i % 2 === 0] })) })).status);
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(12);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("relay: refund retries", () => {
  it("a refund retry for a closed tab is paid once", async () => {
    h.chain.payFee(PAYER, FEE, RELAYER);
    h.chain.head += 1n;
    h.chain.open(3n, BUDGET, RELAYER);
    h.chain.close(3n, BUDGET);
    const first = await (await post({ refund: "3" })).json();
    expect(first.feeRefund.value).toBe(FEE.toString());
    const again = await (await post({ refund: "3" })).json();
    expect(again.feeRefund).toEqual({ value: "0", note: "already refunded" });
    expect(h.chain.refundsTo(PAYER)).toBe(FEE);
  });
});
