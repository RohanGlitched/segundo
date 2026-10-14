import { beforeEach, describe, expect, it, vi } from "vitest";
import { pad, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sealReadMessage, sealUploadMessage } from "@/lib/seal";

/** The server copy of sealed details: only the account reads or replaces it, and an old upload can't roll it back. */

// Throwaway keys made up for this test; they only ever sign messages checked below.
const owner = privateKeyToAccount(pad("0x5ea1", { size: 32 }) as Hex);
const stranger = privateKeyToAccount(pad("0x5ea2", { size: 32 }) as Hex);

const h = vi.hoisted(() => ({ files: new Map<string, string>(), reads: 0 }));
vi.mock("@/lib/storage", () => ({
  storage: () => ({
    read: async (k: string) => {
      h.reads++;
      return h.files.get(k) ?? null;
    },
    write: async (k: string, v: string) => void h.files.set(k, v),
  }),
}));
vi.mock("@/lib/server", () => ({
  clientIp: () => "test",
  limited: () => false,
  json: (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }),
}));

const { GET, PUT } = await import("@/app/api/seal/route");

const envelope = (sealedAt: string) =>
  JSON.stringify({ format: "segundo.sealed-details", version: 2, account: owner.address, credentialId: "cred", nonce: "AAAAAAAAAAAAAAAA", ciphertext: "BBBBBBBBBBBBBBBBBBBBBBBB", sealedAt });

async function put(text: string, signer = owner) {
  const sealedAt = new Date().toISOString();
  const signature = await signer.signMessage({ message: await sealUploadMessage(owner.address, text, sealedAt) });
  return PUT(new Request("http://x/api/seal", { method: "PUT", body: JSON.stringify({ address: owner.address, envelope: text, sealedAt, signature }) }));
}

async function get(opts: { signer?: typeof owner; at?: string; inQuery?: boolean } = {}) {
  const at = opts.at ?? new Date().toISOString();
  const sig = await (opts.signer ?? owner).signMessage({ message: { raw: toHex(new TextEncoder().encode(sealReadMessage(owner.address, at))) } });
  const address = owner.address.toLowerCase();
  if (opts.inQuery) return GET(new Request(`http://x/api/seal?address=${address}&at=${encodeURIComponent(at)}&sig=${sig}`));
  return GET(new Request(`http://x/api/seal?address=${address}`, { headers: { "x-segundo-signed-at": at, "x-segundo-signature": sig } }));
}

beforeEach(() => {
  h.files.clear();
  h.reads = 0;
});

describe("reading the sealed copy", () => {
  it("needs the account's own fresh signature, checked before the store is touched", async () => {
    expect((await put(envelope("2026-10-14T01:00:00.000Z"))).status).toBe(200);
    h.reads = 0;

    const unsigned = await GET(new Request(`http://x/api/seal?address=${owner.address}`));
    expect(unsigned.status).toBe(401);
    expect((await get({ signer: stranger })).status).toBe(401);
    expect((await get({ at: new Date(Date.now() - 10 * 60_000).toISOString() })).status).toBe(401);
    expect(h.reads).toBe(0);

    const ok = await get();
    expect(ok.status).toBe(200);
    expect(JSON.parse(await ok.text())).toMatchObject({ account: owner.address, credentialId: "cred" });
    expect((await get({ inQuery: true })).status).toBe(200);
  });

  it("says nothing is sealed only to the account itself", async () => {
    expect((await GET(new Request(`http://x/api/seal?address=${owner.address}`))).status).toBe(401);
    expect((await get()).status).toBe(404);
  });
});

describe("replacing the sealed copy", () => {
  it("takes a newer seal from the account, refuses an older one and anyone else's", async () => {
    expect((await put(envelope("2026-10-14T01:00:00.000Z"))).status).toBe(200);
    expect((await put(envelope("2026-10-14T02:00:00.000Z"))).status).toBe(200);
    // A captured upload of the first seal, replayed: refused, the newer copy stays.
    expect((await put(envelope("2026-10-14T01:00:00.000Z"))).status).toBe(409);
    expect((await put(envelope("2026-10-14T03:00:00.000Z"), stranger)).status).toBe(401);
    expect(JSON.parse([...h.files.values()][0]!).sealedAt).toBe("2026-10-14T02:00:00.000Z");
  });
});

describe("the passkey session budget", async () => {
  const { asksForPasskey, needsFreshPasskey, passkeyHint } = await import("@/lib/mera-policy");
  const $ = (d: number) => BigInt(Math.round(d * 1e6));

  it("asks for any one action over $50, and for the one that takes the session past $50", () => {
    expect(needsFreshPasskey(0n, $(50))).toBe(false);
    expect(needsFreshPasskey(0n, $(50.01))).toBe(true);
    // Ten $49 sends: the second one asks.
    expect(needsFreshPasskey($(49), $(49))).toBe(true);
    expect(needsFreshPasskey($(45), $(5))).toBe(false);
    expect(needsFreshPasskey($(45), $(5.01))).toBe(true);
  });

  it("only for passkey accounts, and says so before signing", () => {
    const mera = { kind: "mera", session: { spent: $(45) } };
    expect(asksForPasskey(mera, $(10))).toBe(true);
    expect(asksForPasskey({ kind: "privy" }, $(500))).toBe(false);
    expect(passkeyHint(mera, $(10))).toBe("This will ask for your passkey: $45.00 sent since you last confirmed, and this takes it past $50.");
    expect(passkeyHint(mera, $(80))).toBe("This will ask for your passkey: it's over $50.");
    expect(passkeyHint(mera, $(5))).toBeNull();
    expect(passkeyHint({ kind: "practice" }, $(80))).toBeNull();
  });
});

describe("payouts at the rate of their day", () => {
  it("folds the indexer's per-payout rates into spans, exact by transaction where a report landed mid-block", async () => {
    const rows = [
      { block: 100, tx: "0xa1", amount: "1000000", currency: "PHP", rateE6: "57000000", rateAt: 1 },
      { block: 105, tx: "0xa2", amount: "2000000", currency: "PHP", rateE6: "57000000", rateAt: 1 },
      { block: 105, tx: "0xb1", amount: "3000000", currency: "PHP", rateE6: "58000000", rateAt: 2 },
      { block: 110, tx: "0xb2", amount: "4000000", currency: "PHP", rateE6: "58000000", rateAt: 2 },
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ data: { Payout: rows } })));
    const { indexedPayoutRates } = await import("@/lib/hyperindex");
    const r = await indexedPayoutRates("0x00000000000000000000000000000000000000a1");
    fetchMock.mockRestore();
    expect(r.spans).toEqual([
      { currency: "PHP", rateE6: "57000000", at: 1, from: 100, to: 105, payouts: 2, units: "3000000" },
      { currency: "PHP", rateE6: "58000000", at: 2, from: 105, to: 110, payouts: 2, units: "7000000" },
    ]);
    expect(r.exact).toEqual({ "0xa2": 0, "0xb1": 1 });
    expect(r).toMatchObject({ payouts: 4, units: "10000000" });
  });
});
