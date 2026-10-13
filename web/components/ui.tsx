"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { explorerTx } from "@/lib/chain";
import { plainError, type Landed } from "@/lib/relay";
import { useWallet } from "@/lib/wallet";
import styles from "./ui.module.css";

export type Phase = "idle" | "signing" | "sending" | "done" | "error";

/**
 * Runs one action at a time with honest phases: waiting for the signature, then waiting for
 * Monad. The button that started it stays locked until it finishes (no double submits).
 */
export function useAction() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [landed, setLanded] = useState<(Landed & { what: string }) | null>(null);
  const [which, setWhich] = useState<string | null>(null);

  const run = useCallback(async (what: string, fn: (sent: () => void) => Promise<Landed | void>) => {
    setWhich(what);
    setError(null);
    setPhase("signing");
    try {
      const res = await fn(() => setPhase("sending"));
      if (res) setLanded({ ...res, what });
      setPhase("done");
      return res;
    } catch (e) {
      setError(plainError(e));
      setPhase("error");
      return undefined;
    }
  }, []);

  const busy = phase === "signing" || phase === "sending";
  return { phase, error, landed, run, busy, which, clearError: () => setError(null) };
}

export function busyLabel(phase: Phase, idle: string) {
  if (phase === "signing") return "Waiting for your signature…";
  if (phase === "sending") return "Sending to Monad…";
  return idle;
}

/** "Clocked in. Landed in 0.71 s, block 68,081,233." with the transaction one click away. */
export function LandedLine({ landed }: { landed: (Landed & { what: string }) | null }) {
  if (!landed) return null;
  return (
    <p className={styles.landed} role="status">
      {landed.what}. Landed in {(landed.ms / 1000).toFixed(2)} s,{" "}
      <a className="serial" href={explorerTx(landed.hash)} target="_blank" rel="noreferrer">
        block {landed.block.toLocaleString("en-US")}
      </a>
      .
    </p>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [error]);
  if (!error) return null;
  return (
    <p className="notice error" role="alert" ref={ref}>
      {error}
    </p>
  );
}

/**
 * The ways in, in order: a passkey account (Mera, the main one), email (Privy), then a practice wallet.
 * Used by every sign-in panel and by the header's sign-in menu. On the passkey-only site (wallet.accounts "mera")
 * and while the page is still deciding ("pending"), only the passkey choices show.
 */
export function SignInChoices({ compact, onDone }: { compact?: boolean; onDone?: () => void }) {
  const wallet = useWallet();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"up" | "in" | "any" | null>(null);
  // Passkeys belong to one site: on a preview address (or any other host) say so before anyone makes one.
  const [hostNote, setHostNote] = useState<string | null>(null);
  useEffect(() => {
    void import("@/lib/mera").then((m) => setHostNote(m.passkeyHostNote()));
  }, []);
  const passkey = async (which: "up" | "in" | "any") => {
    setError(null);
    setBusy(which);
    try {
      if (which === "up") await wallet.passkeySignUp();
      else await wallet.passkeySignIn({ anyPasskey: which === "any" });
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const off = !wallet.ready || !!busy;
  const waiting = "Waiting for your passkey…";
  const others = wallet.accounts === "full";
  const meraSite = wallet.accounts === "mera";
  return (
    <div className={`${styles.choices} ${compact ? styles.compact : ""}`}>
      <button className={`btn primary ${styles.lead}`} onClick={() => passkey("up")} disabled={off}>
        {busy === "up" ? waiting : "Create your account with a passkey"}
      </button>
      <p className={styles.leadNote}>
        Your fingerprint, face or screen lock. No password, no seed phrase{meraSite ? ", no extension" : ""}. Some devices ask twice the first time.
        {meraSite ? " Same passkey, same account as segundo.world." : ""}
      </p>
      {hostNote && <p className={styles.leadNote}>{hostNote}</p>}
      <button className={`btn ${styles.full}`} onClick={() => passkey("in")} disabled={off}>
        {busy === "in" ? waiting : "Sign back in with your passkey"}
      </button>
      {wallet.hasPasskeyHere && (
        <button className={styles.textBtn} onClick={() => passkey("any")} disabled={off}>
          {busy === "any" ? waiting : "Use a passkey saved on another device"}
        </button>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {others && (
        <>
          <p className={styles.or}>
            <span>or</span>
          </p>
          <div className={styles.signinActions}>
            {wallet.privyEnabled && (
              <button
                className="btn quiet"
                onClick={() => {
                  wallet.signIn();
                  onDone?.();
                }}
                disabled={off}
              >
                Continue with email
              </button>
            )}
            <button
              className={wallet.privyEnabled ? styles.textBtn : "btn quiet"}
              onClick={() => {
                wallet.usePractice();
                onDone?.();
              }}
              disabled={off}
            >
              Use a practice wallet instead
            </button>
          </div>
        </>
      )}
      {!compact &&
        (others ? (
          <p className={styles.fine}>
            Your passkey makes your Segundo account on this device; the key never leaves it and Segundo never sees it.
            {wallet.privyEnabled ? " Email sign-in comes with a wallet created and secured for you by Privy." : ""} A practice wallet lives only in
            this browser and holds test AUSD. You never need MON or gas.
          </p>
        ) : meraSite ? (
          <p className={styles.fine}>
            Your passkey is your whole Segundo account: the key is worked out on this device each time you sign in, never leaves it, and no
            server holds it. You never need MON or gas.
          </p>
        ) : null)}
    </div>
  );
}

/** Shown wherever an action needs a wallet. `level={1}` when the panel is the whole page, so the page keeps one h1. */
export function SignInPanel({ title, children, level = 2 }: { title: string; children?: ReactNode; level?: 1 | 2 }) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div className={styles.signin}>
      {/* As an h1 it keeps the look of the usual h2 (ui.module.css, .signin h2). */}
      <Heading style={level === 1 ? { fontSize: 24, fontVariationSettings: '"wdth" 112' } : undefined}>{title}</Heading>
      {children}
      <SignInChoices />
    </div>
  );
}
