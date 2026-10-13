"use client";

import Link from "next/link";
import { useState } from "react";
import type { Address } from "viem";
import { inviteLink, saveInvite } from "@/lib/invite";
import { hasPasskeyKeys, rebuildInviteKey } from "@/lib/keys";
import { useWallet } from "@/lib/wallet";

/**
 * On a client's own invite tab when the link isn't saved in this browser: a passkey account rebuilds it from the
 * passkey and the chain (lib/keys.ts), then keeps it here like a freshly made one.
 */
export function RebuildInvite({ id, invite, onRebuilt }: { id: bigint; invite: Address; onRebuilt: (link: string) => void }) {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasPasskeyKeys(wallet))
    return <p className="notice">The invite link was made in another browser. Open it there, or close this tab to get the budget back.</p>;

  const rebuild = async () => {
    setBusy(true);
    setError(null);
    try {
      const key = await rebuildInviteKey(wallet, id, invite);
      if (!key) {
        setError(
          "This tab's invite key didn't come from your passkey: it was opened before Segundo made invite keys from passkeys. Open the link in the browser that made it, or close this tab to get the budget back.",
        );
        return;
      }
      saveInvite(id, key);
      onRebuilt(inviteLink(id, key));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="notice">
      <p>
        The invite link isn&apos;t saved in this browser. Its key came from your passkey, so you can rebuild the same link here: the passkey and this tab&apos;s
        place on Monad are all it takes. <Link href="/keys#invite">How it works</Link>
      </p>
      <p style={{ marginTop: 10 }}>
        <button className="btn small primary" onClick={rebuild} disabled={busy}>
          {busy ? "Waiting for your passkey…" : "Rebuild the invite link"}
        </button>
      </p>
      {error && (
        <p className="notice error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}
    </div>
  );
}
