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

/** Shown wherever an action needs a wallet: a passkey or email through Privy, or a practice wallet at once. */
export function SignInPanel({ title, children }: { title: string; children?: ReactNode }) {
  const wallet = useWallet();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const passkey = async (which: "up" | "in") => {
    setError(null);
    setBusy(which);
    try {
      await (which === "up" ? wallet.passkeySignUp?.() : wallet.passkeySignIn?.());
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.warn("passkey", msg);
      setError(
        /(login|signup) with passkey not allowed|not enabled|disabled/i.test(msg)
          ? "Passkey sign-in isn't switched on for Till yet. Continue with email for now."
          : /NotAllowedError|cancel|abort|timed out/i.test(msg)
            ? "The passkey prompt was closed. Try again, or continue with email."
            : "This device couldn't use a passkey here. Continue with email instead.",
      );
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className={styles.signin}>
      <h2>{title}</h2>
      {children}
      {wallet.privyEnabled ? (
        <>
          <div className={styles.signinActions}>
            <button className="btn primary" onClick={() => passkey("up")} disabled={!wallet.ready || !!busy}>
              {busy === "up" ? "Waiting for your passkey…" : "Create an account with a passkey"}
            </button>
            <button className="btn" onClick={() => passkey("in")} disabled={!wallet.ready || !!busy}>
              {busy === "in" ? "Waiting for your passkey…" : "Sign in with a passkey"}
            </button>
          </div>
          <div className={styles.signinActions}>
            <button className="btn quiet" onClick={wallet.signIn} disabled={!wallet.ready || !!busy}>
              Continue with email
            </button>
            <button className="btn quiet" onClick={wallet.usePractice} disabled={!wallet.ready || !!busy}>
              Use a practice wallet instead
            </button>
          </div>
        </>
      ) : (
        <div className={styles.signinActions}>
          <button className="btn primary" onClick={wallet.usePractice} disabled={!wallet.ready}>
            Start with a practice wallet
          </button>
        </div>
      )}
      {error && <p className="notice error">{error}</p>}
      <p className={styles.fine}>
        {wallet.privyEnabled
          ? "A passkey uses your phone or laptop's fingerprint, face or PIN; Till creates a wallet for it. A practice wallet lives only in this browser."
          : "A practice wallet is created in this browser at once. It holds test AUSD only."}{" "}
        You never need MON or gas.
      </p>
    </div>
  );
}
