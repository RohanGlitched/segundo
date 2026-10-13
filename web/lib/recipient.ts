import { getAddress, isAddress, type Address } from "viem";

/**
 * Sending AUSD to an email address. Segundo asks Privy for the wallet that belongs to that email, making one if there
 * isn't one yet (app/api/recipient). The money goes straight to that wallet on Monad; when the person later chooses
 * "Continue with email" on Segundo, Privy signs them into the same account and the AUSD is already there. Shared by
 * the send screen (validation as people type) and the route (the real check).
 */
export type Recipient = { address: Address; existing: boolean };

/** A plain, sendable email address, lower-cased; null if it isn't one. */
export function cleanEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (v.length > 254) return null;
  const at = v.lastIndexOf("@");
  if (at < 1 || at > 64) return null;
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  const labels = domain.split(".");
  if (labels.length < 2 || !/^[a-z]{2,63}$/.test(labels.at(-1)!)) return null;
  return labels.every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) ? v : null;
}

/**
 * The wallet for an email address: the one its owner already has with Segundo, or a new one made for them now.
 * `existing` is true when that person has already signed in to Segundo at least once. Throws an Error with a
 * plain-English message.
 */
export async function resolveRecipient(input: { email: string }): Promise<Recipient> {
  const email = cleanEmail(input.email ?? "");
  if (!email) throw new Error("Enter a full email address, like name@example.com.");
  const res = await fetch("/api/recipient", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  }).catch(() => null);
  if (!res) throw new Error("Couldn't reach Segundo. Check your connection and try again.");
  const data = (await res.json().catch(() => null)) as { address?: string; existing?: boolean; error?: string } | null;
  if (!res.ok || !data?.address || !isAddress(data.address)) throw new Error(data?.error ?? "Couldn't find a wallet for that email. Try again in a moment.");
  return { address: getAddress(data.address), existing: !!data.existing };
}
