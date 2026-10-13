import { getAddress, isAddress, type Address } from "viem";

/**
 * "Request a tab": a freelancer sends their client a link that fills in Segundo's open-a-tab form.
 * Everything in the link is a suggestion from whoever made it, so the open page checks every field here,
 * shows the address and name in full, and the client still reviews and signs the tab themselves.
 */

export type TabRequest = { to: Address; rate: number; budget: number; memo: string; from: string };

export const REQUEST_LIMITS = { minRate: 0.01, maxRate: 1000, minBudget: 0.5, maxBudget: 10_000, memo: 48, name: 40 } as const;

/** Control characters, zero-width characters and bidirectional overrides: nothing that can hide or reorder text in a name. */
const HIDDEN = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;

/** Trims, strips hidden characters, folds runs of spaces and cuts to a length. */
export function cleanText(s: string, max: number): string {
  return s.replace(HIDDEN, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Dollars with at most two decimals, or NaN. */
function money(s: string | null): number {
  if (s == null || !/^\d{1,6}(\.\d{1,2})?$/.test(s.trim())) return NaN;
  return Number(s.trim());
}

const plain = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** The link a freelancer sends. Only the five fields the open page understands. */
export function requestLink(origin: string, r: TabRequest): string {
  const q = new URLSearchParams({ to: r.to, rate: plain(r.rate), budget: plain(r.budget) });
  const memo = cleanText(r.memo, REQUEST_LIMITS.memo);
  const from = cleanText(r.from, REQUEST_LIMITS.name);
  if (memo) q.set("memo", memo);
  if (from) q.set("from", from);
  return `${origin.replace(/\/$/, "")}/open?${q.toString()}`;
}

/** What is wrong with a request as typed, in one plain sentence, or null. */
export function requestProblem(r: { rate: number; budget: number; memo: string; from: string }): string | null {
  const L = REQUEST_LIMITS;
  if (!(r.rate >= L.minRate)) return "Set an hourly rate above zero.";
  if (r.rate > L.maxRate) return "Keep the hourly rate under $1,000 on testnet.";
  if (!(r.budget >= L.minBudget)) return "The smallest tab is $0.50.";
  if (r.budget > L.maxBudget) return "Keep the suggested budget under $10,000 on testnet.";
  if (r.memo.length > L.memo) return `Keep the note under ${L.memo} characters.`;
  if (r.from.length > L.name) return `Keep your name under ${L.name} characters.`;
  return null;
}

/**
 * Reads a request from the open page's query string. Returns null when there is no `to`, or when the address isn't
 * a valid one; out-of-range numbers are dropped (the form keeps its own default) rather than trusted.
 */
export function parseRequest(search: string | URLSearchParams): (Partial<TabRequest> & { to: Address; from: string }) | null {
  const q = typeof search === "string" ? new URLSearchParams(search) : search;
  const raw = q.get("to")?.trim() ?? "";
  if (!isAddress(raw, { strict: false })) return null;
  const to = getAddress(raw);
  const L = REQUEST_LIMITS;
  const rate = money(q.get("rate"));
  const budget = money(q.get("budget"));
  const out: Partial<TabRequest> & { to: Address; from: string } = { to, from: cleanText(q.get("from") ?? "", L.name) };
  if (rate >= L.minRate && rate <= L.maxRate) out.rate = rate;
  if (budget >= L.minBudget && budget <= L.maxBudget) out.budget = budget;
  const memo = cleanText(q.get("memo") ?? "", L.memo);
  if (memo) out.memo = memo;
  return out;
}

/** "0x1234…abcd" grouped in fours, so a client can read the address back to the freelancer. */
export const groupedAddress = (a: Address) => `${a.slice(0, 2)} ${a.slice(2).match(/.{1,4}/g)!.join(" ")}`;
