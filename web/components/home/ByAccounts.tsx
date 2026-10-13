"use client";

import type { ReactNode } from "react";
import { useWallet } from "@/lib/wallet";

/**
 * Copy that depends on how people sign in here: `full` on the main site (passkey, email, practice wallet), `mera` on
 * the passkey-only site. Until the mode is known the passkey wording shows, since it is true on both.
 */
export function ByAccounts({ full, mera }: { full: ReactNode; mera: ReactNode }) {
  const { accounts } = useWallet();
  return <>{accounts === "full" ? full : mera}</>;
}
