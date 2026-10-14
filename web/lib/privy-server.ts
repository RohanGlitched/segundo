import "server-only";
import { createPrivateKey, sign } from "node:crypto";
import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

/**
 * Privy's server API (https://docs.privy.io/api-reference), called with plain fetch: Basic auth with the app id and
 * app secret, plus the privy-app-id header. Used to give an email address a wallet before its owner has ever signed
 * in, so AUSD can be sent to them (lib/recipient.ts), and to sign fee refunds with Segundo's refund wallet, a Privy
 * server wallet (below). The secret lives only in PRIVY_APP_SECRET.
 */
const API = "https://api.privy.io/v1";

type LinkedAccount = {
  type: string;
  address?: string;
  chain_type?: string;
  wallet_client_type?: string;
  wallet_index?: number;
  first_verified_at?: number | null;
  latest_verified_at?: number | null;
};
type PrivyUser = { id: string; linked_accounts: LinkedAccount[] };

export const privyServerReady = () => !!(process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() && process.env.PRIVY_APP_SECRET?.trim());

/** RFC 8785 for the plain JSON Privy requests carry (strings, integers, objects, arrays): sorted keys, no whitespace. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

/**
 * The privy-authorization-signature for a request to a wallet owned by an authorization key: ECDSA P-256 over
 * SHA-256 of the canonical { version, method, url, body, headers } payload, DER, base64. The key ("wallet-auth:" and
 * a base64 PKCS#8 key) lives only in PRIVY_AUTHORIZATION_KEY.
 */
export function authorizationSignature(key: string, method: string, url: string, body: unknown, appId: string): string {
  const payload = { version: 1, method, url, body, headers: { "privy-app-id": appId } };
  const privateKey = createPrivateKey({ key: Buffer.from(key.replace(/^wallet-auth:/, ""), "base64"), format: "der", type: "pkcs8" });
  return sign("sha256", Buffer.from(canonicalJson(payload)), privateKey).toString("base64");
}

/** One call to Privy: the status and parsed body, signed with the authorization key when `signed`. Errors never include a secret. */
async function privy(path: string, body: unknown, { method = "POST", signed = false }: { method?: "GET" | "POST"; signed?: boolean } = {}): Promise<{ status: number; data: unknown }> {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const secret = process.env.PRIVY_APP_SECRET?.trim();
  if (!appId || !secret) throw new Error("Privy is not configured on this deployment.");
  const headers: Record<string, string> = {
    authorization: `Basic ${Buffer.from(`${appId}:${secret}`).toString("base64")}`,
    "privy-app-id": appId,
    "content-type": "application/json",
  };
  if (signed) {
    const key = process.env.PRIVY_AUTHORIZATION_KEY?.trim();
    if (!key) throw new Error("Privy's authorization key is not configured on this deployment.");
    headers["privy-authorization-signature"] = authorizationSignature(key, method, API + path, body, appId);
  }
  const res = await fetch(API + path, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

function asUser(data: unknown): PrivyUser | null {
  const u = data as PrivyUser | null;
  return u && typeof u.id === "string" && Array.isArray(u.linked_accounts) ? u : null;
}

/** The user's first Ethereum embedded wallet: the one Privy's app SDK signs with once they log in. */
function embeddedWallet(u: PrivyUser): Address | undefined {
  const w = u.linked_accounts
    .filter((a) => a.type === "wallet" && a.chain_type === "ethereum" && a.wallet_client_type === "privy" && a.address && isAddress(a.address))
    .sort((a, b) => (a.wallet_index ?? 0) - (b.wallet_index ?? 0))[0];
  return w ? getAddress(w.address!) : undefined;
}

/** True once the owner of the email has signed in (Privy verifies the address on their first login). */
function hasSignedIn(u: PrivyUser): boolean {
  const a = u.linked_accounts.find((x) => x.type === "email");
  return !!(a?.first_verified_at || a?.latest_verified_at);
}

async function findUser(email: string): Promise<PrivyUser | null> {
  const { status, data } = await privy("/users/email/address", { address: email });
  if (status === 404) return null;
  const u = status === 200 ? asUser(data) : null;
  if (!u) throw new Error(`Privy user lookup failed (${status}).`);
  return u;
}

/**
 * The wallet for an email address (already cleaned by lib/recipient.ts). Finds the Privy user, or creates one with an
 * Ethereum embedded wallet made in advance; a user without an embedded wallet gets one added. When the person later
 * logs in with that email, Privy opens this same user and wallet.
 */
export async function recipientWallet(email: string): Promise<{ address: Address; existing: boolean }> {
  let user = await findUser(email);
  if (!user) {
    const { status, data } = await privy("/users", { linked_accounts: [{ type: "email", address: email }], wallets: [{ chain_type: "ethereum" }] });
    // Two sends to the same new person at once: the loser of the race finds the user the winner made.
    user = status === 200 ? asUser(data) : await findUser(email);
    if (!user) throw new Error(`Privy user creation failed (${status}).`);
  }
  let address = embeddedWallet(user);
  if (!address) {
    const { status, data } = await privy(`/users/${encodeURIComponent(user.id)}/wallets`, { wallets: [{ chain_type: "ethereum" }] });
    const updated = status === 200 ? asUser(data) : null;
    address = updated ? embeddedWallet(updated) : undefined;
    if (!address) throw new Error(`Privy wallet creation failed (${status}).`);
  }
  return { address, existing: hasSignedIn(user) };
}

/**
 * Segundo's refund wallet: a Privy server wallet owned by an authorization key and bound to a Privy policy that lets
 * it sign only AUSD transferWithAuthorization (EIP-3009) messages on Monad testnet (chain 10143), worth at most 50
 * AUSD each, and send only AUSD transfers of at most 50 AUSD with no MON; Privy refuses anything else. Made by
 * scripts/privy-refund.mjs. Set by PRIVY_REFUND_WALLET_ID; without it (or the key), refunds come from the treasury key.
 */
export const REFUND_WALLET_CAP = 50_000_000n;
export const privyRefundsReady = () => !!(privyServerReady() && process.env.PRIVY_REFUND_WALLET_ID?.trim() && process.env.PRIVY_AUTHORIZATION_KEY?.trim());

let refundWalletCache: { id: string; address: Address } | null = null;

/** The refund wallet's id and address (read from Privy once per instance), or null when it isn't configured. */
export async function refundWallet(): Promise<{ id: string; address: Address } | null> {
  if (!privyRefundsReady()) return null;
  const id = process.env.PRIVY_REFUND_WALLET_ID!.trim();
  if (refundWalletCache?.id === id) return refundWalletCache;
  const { status, data } = await privy(`/wallets/${encodeURIComponent(id)}`, undefined, { method: "GET" });
  const w = data as { id?: string; address?: string; chain_type?: string } | null;
  if (status !== 200 || !w?.address || !isAddress(w.address) || w.chain_type !== "ethereum") throw new Error(`Privy refund wallet lookup failed (${status}).`);
  refundWalletCache = { id, address: getAddress(w.address) };
  return refundWalletCache;
}

/** An EIP-712 message for Privy's eth_signTypedData_v4: the four parts, numbers as decimal strings. */
export type TypedData = {
  domain: Record<string, unknown>;
  types: Record<string, readonly { name: string; type: string }[]>;
  message: Record<string, unknown>;
  primaryType: string;
};

/** Has a Privy wallet sign typed data, the request signed by the authorization key; the wallet's policy decides. */
export async function privySignTypedData(walletId: string, t: TypedData): Promise<Hex> {
  const body = { method: "eth_signTypedData_v4", caip2: "eip155:10143", params: { typed_data: { domain: t.domain, types: t.types, message: t.message, primary_type: t.primaryType } } };
  const { status, data } = await privy(`/wallets/${encodeURIComponent(walletId)}/rpc`, body, { signed: true });
  const sig = (data as { data?: { signature?: string } } | null)?.data?.signature;
  if (status === 200 && sig && isHex(sig)) return sig;
  const code = (data as { code?: string } | null)?.code;
  throw new Error(`Privy refused to sign (${status}${code ? ` ${code}` : ""}).`);
}
