import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createWalletClient, http, keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { RPC_URL, monadTestnet, publicClient } from "./chain";

/**
 * Segundo's relayer is a pool of keys, not one. Monad lands dozens of transactions from one key in a single block
 * and a hundred a second from a few keys (see /network), so the limit was never the chain: it was one key sending
 * one transaction at a time. KEEPER_KEY is key 0; RELAYER_KEYS (comma-separated) adds the rest.
 *
 * Each request goes to one key chosen from what it is about: a person's address, or a tab's id. The same person
 * always lands on the same key, so their actions keep their order; different people spread across the pool.
 */

const makeClient = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain: monadTestnet, transport: http(RPC_URL) });
export type Relayer = ReturnType<typeof makeClient>;

let cached: { source: string; keys: Relayer[] } | null = null;

/** Every relayer key on this deployment, key 0 first. Throws when even KEEPER_KEY is missing. */
export function pool(): Relayer[] {
  const source = `${process.env.KEEPER_KEY ?? ""}|${process.env.RELAYER_KEYS ?? ""}`;
  if (cached?.source === source) return cached.keys;
  const first = process.env.KEEPER_KEY?.trim();
  if (!first) throw new Error("Relayer is not configured on this deployment.");
  const keys: Relayer[] = [];
  const seen = new Set<string>();
  for (const raw of [first, ...(process.env.RELAYER_KEYS ?? "").split(",")]) {
    const k = raw.trim().replace(/^["']|["']$/g, "");
    if (!k) continue;
    const key = (k.startsWith("0x") ? k : `0x${k}`) as Hex;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      console.warn(`relayer pool: skipped a malformed key (#${keys.length})`);
      continue;
    }
    const client = makeClient(key);
    if (seen.has(client.account.address)) continue;
    seen.add(client.account.address);
    keys.push(client);
  }
  cached = { source, keys };
  return keys;
}

/** Which key a request belongs to: hash(address) mod N for a person, id mod N for a tab. */
export function laneOf(seed: Address | bigint, size = pool().length): number {
  if (size <= 1) return 0;
  const n = typeof seed === "bigint" ? seed : BigInt(keccak256(seed.toLowerCase() as Hex));
  return Number(n % BigInt(size));
}

let monCache: { at: number; mon: (bigint | null)[] } | null = null;
let monReading: Promise<(bigint | null)[]> | null = null;
/** Every pool key's MON (null where the read failed), read at most every ten seconds per instance and once for a burst of requests. */
export async function poolMon(): Promise<(bigint | null)[]> {
  const keys = pool();
  if (monCache && monCache.mon.length === keys.length && Date.now() - monCache.at < 10_000) return monCache.mon;
  monReading ??= Promise.all(keys.map((k) => publicClient.getBalance({ address: k.account.address }).catch(() => null)))
    .then((mon) => {
      if (mon.some((m) => m !== null)) monCache = { at: Date.now(), mon };
      return mon;
    })
    .finally(() => (monReading = null));
  return monReading;
}

/** The pool key with the most MON (key 0 when nothing could be read). */
export function richest(mon: (bigint | null)[]): number {
  let best = 0;
  mon.forEach((m, i) => {
    if (m !== null && (mon[best] === null || m > mon[best]!)) best = i;
  });
  return best;
}

/**
 * The key a request was given, for code that asks for "the keeper" without knowing about the pool (the treasury's
 * fee refunds): inside `asRelayer(key, fn)`, signer("keeper") is that key.
 */
const current = new AsyncLocalStorage<Relayer>();
export const asRelayer = <T>(key: Relayer, fn: () => Promise<T>) => current.run(key, fn);
export const currentRelayer = () => current.getStore();
