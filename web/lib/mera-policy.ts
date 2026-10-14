/**
 * What a passkey (Mera) signing session covers without asking again. Plain constants with no browser code, so server
 * pages (/keys) can print the same numbers the signer in lib/wallet.tsx enforces.
 *
 * Inside an unlocked session, routine actions sign with no prompt: clock in and out, pause, rate changes, payouts and
 * closing (the contract only pays the freelancer what's earned and refunds the rest), and the profile. Sends, opens
 * and top-ups share a rolling $50 budget: any one over $50, or one that takes what has moved since the last passkey
 * prompt past $50, asks for the passkey again, and that prompt starts the budget over. Opening sealed details asks
 * every time (lib/seal.ts).
 */

/** AUSD units (6 decimals) a single transfer or permit may move inside the session without a fresh passkey check: $50. */
export const PROMPT_FREE_UNITS = 50_000_000n;
export const PROMPT_FREE_LABEL = "$50";
/**
 * AUSD units all sends, opens and top-ups together may move between passkey prompts: $50, so ten $49 sends can't
 * slip through one unlock. Any passkey prompt (signing in, unlocking, a fresh check) starts it over.
 */
export const SESSION_BUDGET_UNITS = 50_000_000n;
export const SESSION_BUDGET_LABEL = "$50";

/** How long a finished passkey prompt counts as fresh for one sensitive action. */
export const FRESH_MS = 60_000;

/** The session's budget so far (lib/wallet.tsx): AUSD units sent, opened or topped up since the last passkey prompt. */
export type PasskeySession = { spent: bigint };

/** Whether moving `units` after `spent` since the last prompt needs a fresh passkey check. */
export const needsFreshPasskey = (spent: bigint, units: bigint): boolean =>
  units > PROMPT_FREE_UNITS || spent + units > SESSION_BUDGET_UNITS;

/** Whether this wallet asks for the passkey again before moving `units` of AUSD (passkey accounts only). */
export function asksForPasskey(wallet: { kind: string | null; session?: PasskeySession }, units: bigint): boolean {
  return wallet.kind === "mera" && needsFreshPasskey(wallet.session?.spent ?? 0n, units);
}

const usd = (units: bigint) => `$${(Number(units) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * One line to show before signing, when this action will ask for the passkey: "This will ask for your passkey:
 * $45.00 sent since you last confirmed." Null when the session covers it (or the wallet has no passkey).
 */
export function passkeyHint(wallet: { kind: string | null; session?: PasskeySession }, units: bigint): string | null {
  if (wallet.kind !== "mera" || units <= 0n) return null;
  const spent = wallet.session?.spent ?? 0n;
  if (units > PROMPT_FREE_UNITS) return `This will ask for your passkey: it's over ${PROMPT_FREE_LABEL}.`;
  if (spent + units > SESSION_BUDGET_UNITS)
    return `This will ask for your passkey: ${usd(spent)} sent since you last confirmed, and this takes it past ${SESSION_BUDGET_LABEL}.`;
  return null;
}

/** What the session still covers before the next prompt, in AUSD units (for a "$12 left" chip). */
export const budgetLeft = (session: PasskeySession | undefined): bigint => {
  const left = SESSION_BUDGET_UNITS - (session?.spent ?? 0n);
  return left > 0n ? left : 0n;
};
