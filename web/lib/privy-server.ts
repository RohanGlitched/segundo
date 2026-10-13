import "server-only";
import { getAddress, isAddress, type Address } from "viem";

/**
 * Privy's server API (https://docs.privy.io/api-reference), called with plain fetch: Basic auth with the app id and
 * app secret, plus the privy-app-id header. Used to give an email address a wallet before its owner has ever signed
 * in, so AUSD can be sent to them (lib/recipient.ts). The secret lives only in PRIVY_APP_SECRET.
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

/** One call to Privy: the status and parsed body. Errors never include the secret. */
async function privy(path: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const secret = process.env.PRIVY_APP_SECRET?.trim();
  if (!appId || !secret) throw new Error("Privy is not configured on this deployment.");
  const res = await fetch(API + path, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${appId}:${secret}`).toString("base64")}`,
      "privy-app-id": appId,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
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
