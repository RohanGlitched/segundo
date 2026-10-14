import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authorizationSignature, canonicalJson } from "@/lib/privy-server";

describe("Privy authorization signatures", () => {
  it("canonical JSON sorts keys at every depth and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: "x", y: null }], c: undefined } })).toBe('{"a":{"d":[3,{"y":null,"z":"x"}]},"b":1}');
  });

  it("signs the canonical request payload with the P-256 authorization key, verifiable by its public key", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const key = "wallet-auth:" + privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    const url = "https://api.privy.io/v1/wallets/w1/rpc";
    const body = { method: "eth_signTypedData_v4", caip2: "eip155:10143", params: { typed_data: { primary_type: "TransferWithAuthorization" } } };
    const sig = authorizationSignature(key, "POST", url, body, "app-1");
    const payload = canonicalJson({ version: 1, method: "POST", url, body, headers: { "privy-app-id": "app-1" } });
    expect(verify("sha256", Buffer.from(payload), publicKey, Buffer.from(sig, "base64"))).toBe(true);
    // A different body (another amount, say) doesn't carry the same signature.
    const other = canonicalJson({ version: 1, method: "POST", url, body: { ...body, caip2: "eip155:1" }, headers: { "privy-app-id": "app-1" } });
    expect(verify("sha256", Buffer.from(other), publicKey, Buffer.from(sig, "base64"))).toBe(false);
  });
});
