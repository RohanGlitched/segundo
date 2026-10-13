"use client";

import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { DOLLAR, dollarAbi, publicClient } from "./chain";
import { CURRENCIES } from "./money";

/**
 * Send by link: the sender moves AUSD to a fresh key made in their browser and shares that key inside a link.
 * Whoever opens the link signs one transfer with it, from the link's address to their own new account. The key
 * travels only in the part of the link after #, which browsers never send to a server, and the link's address
 * never needs MON: both the send and the collect are EIP-3009 transfers the relayer submits.
 *
 *   https://segundo.world/claim#k=<key, 64 hex>&a=<dollars>&c=<their currency>&f=<sender's name>
 */
export type LinkFragment = { key: Hex; address: Address; usd: number; cur: string; from: string };

/** One link this browser sent, kept so the sender can share it again or take the money back. */
export type SentLink = {
  key: Hex;
  address: Address;
  /** AUSD base units, as a decimal string. */
  value: string;
  cur: string;
  from: string;
  at: number;
  /** "sending" until the transfer into the link lands; "back" once the sender has taken it back. */
  state: "sending" | "sent" | "back";
  hash?: Hex;
  block?: number;
  backHash?: Hex;
};

export const newLinkKey = (): { key: Hex; address: Address } => {
  const key = generatePrivateKey();
  return { key, address: privateKeyToAccount(key).address };
};

export function claimLink(origin: string, l: Pick<SentLink, "key" | "value" | "cur" | "from">): string {
  const usd = (Number(l.value) / 1e6).toFixed(2);
  const q = new URLSearchParams({ k: l.key.slice(2), a: usd, c: l.cur });
  if (l.from.trim()) q.set("f", l.from.trim().slice(0, 40));
  return `${origin.replace(/\/$/, "")}/claim#${q.toString()}`;
}

/** Reads a claim link's fragment ("#k=…&a=…"). Returns null when the key is missing or malformed. */
export function readFragment(hash: string): LinkFragment | null {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const k = q.get("k")?.replace(/^0x/, "") ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(k)) return null;
  const key = `0x${k.toLowerCase()}` as Hex;
  let address: Address;
  try {
    address = privateKeyToAccount(key).address;
  } catch {
    return null;
  }
  const usd = Number(q.get("a"));
  const c = (q.get("c") ?? "USD").toUpperCase();
  return {
    key,
    address,
    usd: Number.isFinite(usd) && usd > 0 ? usd : 0,
    cur: CURRENCIES.some((x) => x.code === c) ? c : "USD",
    from: (q.get("f") ?? "").trim().slice(0, 40),
  };
}

/** AUSD sitting at a link's address right now. */
export const linkBalance = async (address: Address): Promise<bigint> =>
  (await publicClient.readContract({ address: DOLLAR, abi: dollarAbi, functionName: "balanceOf", args: [address] })) as bigint;

/** Balances of several links in one batched round trip; a link that can't be read comes back null. */
export async function linkBalances(addresses: Address[]): Promise<(bigint | null)[]> {
  return Promise.all(addresses.map((a) => linkBalance(a).catch(() => null)));
}

const storeKey = (sender: string) => `segundo.links.v1.${sender.toLowerCase()}`;
/** Fired whenever this browser's list of sent links changes, so every list on the page re-reads. */
export const LINKS_CHANGED = "segundo:links";

export function readSentLinks(sender?: string): SentLink[] {
  if (!sender) return [];
  try {
    const raw = localStorage.getItem(storeKey(sender));
    const list = raw ? (JSON.parse(raw) as SentLink[]) : [];
    return Array.isArray(list) ? list.filter((l) => l && /^0x[0-9a-f]{64}$/i.test(l.key)) : [];
  } catch {
    return [];
  }
}

function writeSentLinks(sender: string, list: SentLink[]) {
  try {
    localStorage.setItem(storeKey(sender), JSON.stringify(list.slice(0, 60)));
  } catch {}
  window.dispatchEvent(new Event(LINKS_CHANGED));
}

/** Adds or updates one link (matched by its address), newest first. */
export function saveSentLink(sender: string, link: SentLink) {
  const rest = readSentLinks(sender).filter((l) => l.address.toLowerCase() !== link.address.toLowerCase());
  writeSentLinks(sender, [link, ...rest]);
}

export function updateSentLink(sender: string, address: Address, patch: Partial<SentLink>) {
  writeSentLinks(
    sender,
    readSentLinks(sender).map((l) => (l.address.toLowerCase() === address.toLowerCase() ? { ...l, ...patch } : l)),
  );
}

export function dropSentLink(sender: string, address: Address) {
  writeSentLinks(
    sender,
    readSentLinks(sender).filter((l) => l.address.toLowerCase() !== address.toLowerCase()),
  );
}

/** Whether this browser sent the link at `address` (from any account signed in here), and from which account. */
export function findSentLink(address: Address): { sender: string; link: SentLink } | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith("segundo.links.v1.")) continue;
      const sender = k.slice("segundo.links.v1.".length);
      const link = readSentLinks(sender).find((l) => l.address.toLowerCase() === address.toLowerCase());
      if (link) return { sender, link };
    }
  } catch {}
  return null;
}
