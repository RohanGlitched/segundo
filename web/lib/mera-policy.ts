/**
 * What a passkey (Mera) signing session covers without asking again. Plain constants with no browser code, so server
 * pages (/keys) can print the same numbers the signer in lib/wallet.tsx enforces.
 *
 * Inside an unlocked session, routine actions sign with no prompt: clock in and out, pause, rate changes, payouts and
 * closing (the contract only pays the freelancer what's earned and refunds the rest), the profile, and any send, open
 * or top-up up to $50. Above $50, an AUSD transfer or permit asks for the passkey again; opening sealed details asks
 * every time (lib/seal.ts).
 */

/** AUSD units (6 decimals) a transfer or permit may move inside the session without a fresh passkey check: $50. */
export const PROMPT_FREE_UNITS = 50_000_000n;
export const PROMPT_FREE_LABEL = "$50";

/** How long a finished passkey prompt counts as fresh for one sensitive action. */
export const FRESH_MS = 60_000;

/** Whether this wallet asks for the passkey again before moving `units` of AUSD (passkey accounts, above $50). */
export function asksForPasskey(wallet: { kind: string | null }, units: bigint): boolean {
  return wallet.kind === "mera" && units > PROMPT_FREE_UNITS;
}
