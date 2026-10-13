import type { Address } from "viem";
import { tillAbi } from "./abi";
import { TILL, publicClient } from "./chain";

export type Tab = {
  payer: Address;
  rate: bigint;
  held: boolean;
  closed: boolean;
  payee: Address;
  since: bigint;
  invite: Address;
  lastBlock: bigint;
  budget: bigint;
  banked: bigint;
  paid: bigint;
};

export type TabView = { id: bigint; tab: Tab; earned: bigint; owed: bigint; runway: bigint };

export type Profile = { name: string; place: string; currency: string };

const ZERO = "0x0000000000000000000000000000000000000000";

/** Same arithmetic as Till._earned, so the note can tick every second between reads without drifting. */
export function earnedAt(t: Tab, now: number): bigint {
  let e = t.banked;
  if (t.since > 0n) {
    const elapsed = BigInt(Math.max(0, now - Number(t.since)));
    e += (elapsed * t.rate) / 3600n;
  }
  return e > t.budget ? t.budget : e;
}

export type TabState = "invited" | "working" | "idle" | "paused" | "spent" | "closed";

export function stateOf(t: Tab, now: number): TabState {
  if (t.closed) return "closed";
  if (t.payee === ZERO) return "invited";
  if (earnedAt(t, now) >= t.budget) return "spent";
  if (t.since > 0n) return "working";
  if (t.held) return "paused";
  return "idle";
}

export const STATE_WORDS: Record<TabState, string> = {
  invited: "Waiting for the freelancer to join",
  working: "On the clock",
  idle: "Clocked out",
  paused: "Pay paused by the client",
  spent: "Budget used up",
  closed: "Closed",
};

/**
 * STATE_WORDS for one tab: a freelancer who has joined but never clocked in hasn't "clocked out" of anything. Nothing
 * banked and nothing paid means no session has ended yet (a session banks what it earned when it stops).
 */
export function stateWord(t: Tab, state: TabState): string {
  if (state === "idle" && t.banked === 0n && t.paid === 0n) return "Ready to clock in";
  return STATE_WORDS[state];
}

export async function readTabs(ids: bigint[]): Promise<TabView[]> {
  if (!ids.length) return [];
  const out: TabView[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const res = (await publicClient.readContract({ address: TILL, abi: tillAbi, functionName: "getTabs", args: [chunk] })) as readonly TabView[];
    out.push(...res.map((r) => ({ ...r, tab: { ...r.tab } })));
  }
  return out;
}

export async function readProfiles(addrs: Address[]): Promise<Record<string, Profile>> {
  const unique = [...new Set(addrs.filter((a) => a && a !== ZERO).map((a) => a.toLowerCase() as Address))];
  // One multicall for every profile instead of a request each.
  const res = unique.length
    ? (
        await publicClient.multicall({
          contracts: unique.map((a) => ({ address: TILL, abi: tillAbi, functionName: "profileOf", args: [a] }) as const),
          allowFailure: true,
        })
      ).map((r) => (r.status === "success" ? r.result : null))
    : [];
  const map: Record<string, Profile> = {};
  unique.forEach((a, i) => {
    const p = res[i] as { name: string; place: string; currency: `0x${string}` } | null;
    if (!p) return;
    map[a] = { name: p.name, place: p.place, currency: bytes3ToCode(p.currency) };
  });
  return map;
}

export function bytes3ToCode(hex: `0x${string}`): string {
  const clean = hex.slice(2).replace(/(00)+$/, "");
  let s = "";
  for (let i = 0; i < clean.length; i += 2) s += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  return s;
}

export function codeToBytes3(code: string): `0x${string}` {
  const hex = [...code.slice(0, 3).toUpperCase()].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  return `0x${hex.padEnd(6, "0")}`;
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const isZero = (a?: string) => !a || a === ZERO;
