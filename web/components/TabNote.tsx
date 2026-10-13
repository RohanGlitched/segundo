"use client";

import { useLive, useChainNow } from "@/lib/live";
import { ago, currency, formatDuration, formatUsd, toUsd } from "@/lib/money";
import { earnedAt, isZero, shortAddress, stateOf, stateWord, type Profile, type TabView } from "@/lib/tabs";
import { Note } from "./Note";

export function personOf(addr: string, profiles: Record<string, Profile>, fallbackPlace = "") {
  const p = profiles[addr.toLowerCase()];
  return {
    name: p?.name || (isZero(addr) ? "The freelancer" : shortAddress(addr)),
    place: p?.place || fallbackPlace,
    currency: p?.currency || "USD",
  };
}

/** A live note for one tab: the amount ticks with chain time between reads. */
export function TabNote({
  view,
  profiles,
  lastPaidAt,
  engrave,
  invited,
}: {
  view: TabView;
  profiles: Record<string, Profile>;
  lastPaidAt?: number;
  engrave?: boolean;
  /** The freelancer joined from an invite link (the contract clears the invite on claim, so only the history knows). */
  invited?: boolean;
}) {
  const { head, rates } = useLive();
  const now = useChainNow();
  const t = view.tab;
  const earned = earnedAt(t, now);
  const state = stateOf(t, now);
  // Without a city on their profile, the freelancer's line says how they joined, or nothing at all.
  const payee = personOf(t.payee, profiles, invited ? "invited by link" : "");
  const payer = personOf(t.payer, profiles);
  const rateUsd = toUsd(t.rate);
  const hours = rateUsd > 0 ? toUsd(earned) / rateUsd : 0;
  // The big figure is everything earned since the tab opened; the status line is this shift alone, so a long-running
  // tab's total never reads as if it were earned in the current shift.
  const shiftSeconds = state === "working" ? Math.max(0, now - Number(t.since)) : 0;
  const left = t.budget > t.banked ? t.budget - t.banked : 0n;
  const shiftEarned = (BigInt(shiftSeconds) * t.rate) / 3600n;
  const status =
    state === "working"
      ? `This shift: ${formatUsd(toUsd(shiftEarned < left ? shiftEarned : left))} (${formatDuration(shiftSeconds)})`
      : stateWord(t, state);
  const serialBits = [head ? `block ${head.number.toLocaleString("en-US")}` : null, lastPaidAt ? `paid ${ago(now - lastPaidAt)}` : null].filter(Boolean);

  return (
    <Note
      id={view.id}
      usd={toUsd(earned)}
      cur={currency(payee.currency)}
      rates={rates}
      payee={payee}
      payer={payer}
      rateUsd={rateUsd}
      hours={hours}
      live={state === "working"}
      status={status}
      span="since the tab opened"
      serialLine={serialBits.join(", ") || undefined}
      engrave={engrave}
    />
  );
}
