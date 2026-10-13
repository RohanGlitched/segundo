"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { createWalletClient, custom, type Address, type Hex, type TypedDataDefinition } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { TREASURY, monadTestnet } from "./chain";
import type { MeraUnlocked } from "./mera";
import type { PrivyCalls, PrivyMountProps, PrivyState } from "./privy-bridge";
import { FRESH_MS, PROMPT_FREE_UNITS } from "./mera-policy";
import { formatUsd, toUsd } from "./money";

/**
 * One wallet interface for the app. The main way in is a passkey account made with Mera: the passkey's PRF output
 * becomes the account key in this browser, no seed phrase, no server holding anything. Email through Privy (an
 * embedded wallet) stays as the second way in, and a practice wallet kept in this browser is the quick last option.
 * Segundo never asks any of them to pay gas: every action is a signature the relayer submits.
 *
 * The passkey-only build (NEXT_PUBLIC_ACCOUNTS=mera, or any page served from a mera.* host such as mera.segundo.world)
 * offers Mera alone: Privy is never loaded and there is no practice wallet. The passkey's relying party is
 * segundo.world, so the same passkey opens the same account on both sites.
 */
export type Wallet = {
  ready: boolean;
  address?: Address;
  kind: "mera" | "privy" | "practice" | null;
  label: string;
  /** How the person signed in: a passkey (Mera) or email (Privy). */
  method?: "passkey" | "email";
  /**
   * Which ways in this page offers: "full" (passkey, email, practice wallet), "mera" (passkey only), or "pending"
   * while the page is still deciding (server render and first paint; treat it like "mera" but keep buttons disabled).
   */
  accounts: AccountsMode;
  privyEnabled: boolean;
  /** One line about who holds the key, for the account menu (Privy: "Your wallet is created and secured by Privy…"). */
  note?: string;
  /** Privy only: opens Privy's own window for copying the embedded wallet's private key (Segundo never sees it). */
  exportKey?: () => Promise<void>;
  /** Email sign-in through Privy. Without Privy configured, starts the practice wallet. */
  signIn: () => void;
  /** Mera: make a new passkey and its Segundo account. Throws an Error with a plain-English message. */
  passkeySignUp: () => Promise<void>;
  /** Mera: sign back in. Uses the passkey last used in this browser unless `anyPasskey` (e.g. one from a phone). */
  passkeySignIn: (opts?: { anyPasskey?: boolean }) => Promise<void>;
  /** A Segundo passkey was used in this browser before, so "Sign back in" leads. */
  hasPasskeyHere: boolean;
  /** Mera only: whether the signing key is in memory right now. When false, the next signature asks for the passkey. */
  unlocked: boolean;
  /** Mera only: end the signing session now (it also ends after 15 minutes idle or 5 minutes in the background). */
  lock?: () => void;
  /** Mera only: ask for the passkey now, so the next signatures don't have to. */
  unlock?: () => Promise<void>;
  /**
   * Passkey accounts: ask for the passkey again before a sensitive action, even inside an unlocked session (see
   * PROMPT_FREE_UNITS). Resolves at once for email and practice wallets. `reason` ("Sending $120.00") names the
   * action if the prompt is closed. Call it first in a tap handler: Safari only shows a passkey prompt shortly after a tap.
   */
  confirmWithPasskey: (reason: string) => Promise<void>;
  /**
   * Mera only: the passkey behind the account and its sealing key for private details (lib/seal.ts). `fresh` asks
   * the passkey even if the key is in memory: opening (reading) details always does; sealing them doesn't.
   */
  mera?: { credentialId: string; sealingKey: (opts?: { fresh?: boolean }) => Promise<CryptoKey> };
  usePractice: () => void;
  signOut: () => void;
  signTypedData: (data: TypedDataDefinition) => Promise<Hex>;
  signMessage: (raw: Hex) => Promise<Hex>;
};

export type AccountsMode = "full" | "mera" | "pending";

/* ---------- What asks for the passkey ---------- */

/**
 * The policy (lib/mera-policy.ts) is enforced here, in the signer: Mera's signTypedData below reads what is being
 * signed, so every page follows it. Over $50, an AUSD transfer or permit needs a fresh passkey check. Segundo's 1% fee
 * is exempt: it signs with the open or top-up whose permit already asked. A passkey prompt finished in the last minute
 * (signing in, unlocking, an invite key) counts once, so nothing asks twice in a row. Email (Privy) and practice
 * wallets are unchanged.
 */
export { PROMPT_FREE_LABEL, PROMPT_FREE_UNITS, asksForPasskey } from "./mera-policy";

const usdOf = (units: bigint) => formatUsd(toUsd(units));

/** The action a typed-data signature stands for, if it needs a fresh passkey check; null when the session covers it. */
function sensitiveReason(data: TypedDataDefinition): string | null {
  const m = data.message as Record<string, unknown> | undefined;
  const value = typeof m?.value === "bigint" ? m.value : null;
  if (value == null || value <= PROMPT_FREE_UNITS) return null;
  if (data.primaryType === "TransferWithAuthorization") {
    const to = typeof m?.to === "string" ? m.to.toLowerCase() : "";
    return to === TREASURY.toLowerCase() ? null : `Sending ${usdOf(value)}`;
  }
  if (data.primaryType === "Permit") return `Putting ${usdOf(value)} into a tab`;
  return null;
}

const WalletContext = createContext<Wallet | null>(null);
const PRACTICE_KEY = "till.practice.v1";
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const MERA_BUILD = process.env.NEXT_PUBLIC_ACCOUNTS === "mera";

/** True on the passkey-only site (mera.segundo.world, or mera.localhost in development). */
export const isMeraHost = (hostname: string) => hostname.startsWith("mera.");

/**
 * Decided after mount from the build flag or the hostname, so the server render and the first client render match.
 * Until then it is "pending": no Privy, no practice wallet, sign-in buttons disabled.
 */
function useAccountsMode(): AccountsMode {
  const [mode, setMode] = useState<AccountsMode>(MERA_BUILD ? "mera" : "pending");
  useEffect(() => {
    if (!MERA_BUILD) setMode(isMeraHost(window.location.hostname) ? "mera" : "full");
  }, []);
  return mode;
}

const SIGNED_OUT = "till.practice.signedOut";

/** The practice key stays in this browser after signing out (so its test AUSD isn't lost); a flag hides it. */
function readPractice(includeSignedOut = false): Hex | null {
  try {
    if (!includeSignedOut && localStorage.getItem(SIGNED_OUT) === "1") return null;
    return (localStorage.getItem(PRACTICE_KEY) as Hex | null) ?? null;
  } catch {
    return null;
  }
}

function usePracticeWallet() {
  const [key, setKey] = useState<Hex | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setKey(readPractice());
    setLoaded(true);
  }, []);
  const account = useMemo(() => (key ? privateKeyToAccount(key) : null), [key]);
  const create = useCallback(() => {
    const k = readPractice(true) ?? generatePrivateKey();
    try {
      localStorage.setItem(PRACTICE_KEY, k);
      localStorage.removeItem(SIGNED_OUT);
    } catch {}
    setKey(k);
  }, []);
  const forget = useCallback(() => {
    try {
      localStorage.setItem(SIGNED_OUT, "1");
    } catch {}
    setKey(null);
  }, []);
  return { account, loaded, create, forget };
}

/* ---------- Mera passkey account ---------- */

/** What this browser remembers about a passkey account: public facts only, never key material. */
type MeraRecord = { credentialId: string; transports?: string[]; address: Address; signedIn: boolean };
const MERA_KEY = "segundo.passkey.v1";
const IDLE_MS = 15 * 60_000;
const HIDDEN_MS = 5 * 60_000;

/**
 * lib/mera.ts loads after first paint and is then kept, so a passkey prompt starts right after a tap: Safari only
 * shows a passkey prompt within a short time of the tap that asked for it.
 */
let meraModule: typeof import("./mera") | null = null;
let meraLoading: Promise<typeof import("./mera")> | null = null;
function loadMera() {
  if (meraModule) return Promise.resolve(meraModule);
  meraLoading ??= import("./mera").then((m) => (meraModule = m));
  return meraLoading;
}
let sealModule: typeof import("./seal") | null = null;
function loadSeal() {
  return sealModule ? Promise.resolve(sealModule) : import("./seal").then((m) => (sealModule = m));
}

function readMera(): MeraRecord | null {
  try {
    const raw = localStorage.getItem(MERA_KEY);
    const v = raw ? (JSON.parse(raw) as MeraRecord) : null;
    return v && typeof v.credentialId === "string" && /^0x[0-9a-fA-F]{40}$/.test(v.address) ? v : null;
  } catch {
    return null;
  }
}

function writeMera(v: MeraRecord) {
  try {
    localStorage.setItem(MERA_KEY, JSON.stringify(v));
  } catch {}
}

/**
 * Holds the Mera signing session while the person is signed in. The key lives only in page memory (inside Mera's
 * session, which zeroes it on end); it ends on sign-out, after 15 minutes without activity, after 5 minutes with the
 * page in the background, and when the page is closed. The next signature then asks for the passkey again.
 */
function useMeraAccount(onSignedIn: () => void) {
  const [record, setRecord] = useState<MeraRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const recordRef = useRef<MeraRecord | null>(null);
  const live = useRef<MeraUnlocked | null>(null);
  const pending = useRef<Promise<MeraUnlocked> | null>(null);
  const sealKey = useRef<CryptoKey | null>(null);
  const sealPending = useRef<Promise<CryptoKey> | null>(null);
  const lastActive = useRef(0);
  /** The passkey prompt (lib/mera.ts lastAssertion) already spent on a sensitive action: each prompt covers one. */
  const spentAssertion = useRef(0);
  /** Set by confirmWithPasskey: the next sensitive signature within a minute uses that check instead of asking again. */
  const grant = useRef(0);
  /** Bumped by every lock: a passkey prompt that finishes after a lock or sign-out must not sign anyone back in. */
  const epoch = useRef(0);
  const signedInHook = useRef(onSignedIn);
  signedInHook.current = onSignedIn;

  useEffect(() => {
    const r = readMera();
    recordRef.current = r;
    setRecord(r);
    setLoaded(true);
    const t = setTimeout(() => {
      void loadMera();
      if (r?.signedIn) void loadSeal();
    }, 400);
    return () => clearTimeout(t);
  }, []);

  const lock = useCallback(() => {
    epoch.current++;
    live.current?.session.end();
    live.current = null;
    sealKey.current = null;
    grant.current = 0;
    setUnlocked(false);
    // Anything showing unsealed details (components/SealedDetails.tsx) clears itself on this.
    window.dispatchEvent(new Event("segundo:lock"));
  }, []);

  const adopt = useCallback((u: MeraUnlocked) => {
    if (live.current && live.current !== u) live.current.session.end();
    live.current = u;
    lastActive.current = Date.now();
    const r: MeraRecord = {
      credentialId: u.credential.credentialId,
      ...(u.credential.transports ? { transports: [...u.credential.transports] } : {}),
      address: u.address,
      signedIn: true,
    };
    writeMera(r);
    recordRef.current = r;
    setRecord(r);
    setUnlocked(true);
    signedInHook.current();
  }, []);

  const signUp = useCallback(async () => {
    const m = meraModule ?? (await loadMera());
    try {
      lock();
      adopt(await m.createAccount());
    } catch (e) {
      throw new Error(m.meraMessage(e));
    }
  }, [adopt, lock]);

  const signIn = useCallback(
    async (opts?: { anyPasskey?: boolean }) => {
      const m = meraModule ?? (await loadMera());
      const known = opts?.anyPasskey ? null : readMera();
      try {
        const u = await m.unlockAccount(known ? { credentialId: known.credentialId, transports: known.transports } : undefined);
        lock();
        adopt(u);
      } catch (e) {
        throw new Error(m.meraMessage(e));
      }
    },
    [adopt, lock],
  );

  /** The live signing account, asking for the passkey if the session ended. Parallel callers share one prompt. */
  const ensure = useCallback(async (): Promise<MeraUnlocked> => {
    if (live.current) {
      lastActive.current = Date.now();
      return live.current;
    }
    const r = recordRef.current;
    if (!r?.signedIn) throw new Error("Sign in first.");
    if (!pending.current) {
      pending.current = (async () => {
        const m = meraModule ?? (await loadMera());
        const started = epoch.current;
        try {
          const u = await m.unlockAccount({ credentialId: r.credentialId, transports: r.transports });
          if (epoch.current !== started) {
            u.session.end();
            throw new Error("Signing was locked while the passkey prompt was open. Try again.");
          }
          if (u.address.toLowerCase() !== r.address.toLowerCase()) {
            u.session.end();
            throw new Error("That passkey opens a different Segundo account. Sign out first, then sign in with it.");
          }
          adopt(u);
          return u;
        } catch (e) {
          throw new Error(m.meraMessage(e));
        } finally {
          pending.current = null;
        }
      })();
    }
    return pending.current;
  }, [adopt]);

  /**
   * A fresh passkey check for one sensitive action. A prompt this passkey finished in the last minute that no other
   * sensitive action has used counts (signing in, then sending $80, is one prompt). Otherwise it asks: the assertion
   * re-derives the account, must give the same address, and replaces the signing session, so a locked session is
   * unlocked by the same prompt.
   */
  const check = useCallback(
    async (reason: string): Promise<void> => {
      const r = recordRef.current;
      if (!r?.signedIn) throw new Error("Sign in first.");
      const m = meraModule ?? (await loadMera());
      const at = m.lastAssertion(r.credentialId);
      if (at > spentAssertion.current && Date.now() - at < FRESH_MS) {
        spentAssertion.current = at;
        return;
      }
      const started = epoch.current;
      let u: MeraUnlocked;
      try {
        u = await m.unlockAccount({ credentialId: r.credentialId, transports: r.transports });
      } catch (e) {
        throw new Error(m.promptClosed(e) ? `${reason} needs your passkey again, and the prompt was closed. Nothing was signed; try again.` : m.meraMessage(e));
      }
      if (epoch.current !== started) {
        u.session.end();
        throw new Error("Signing was locked while the passkey prompt was open. Try again.");
      }
      if (u.address.toLowerCase() !== r.address.toLowerCase()) {
        u.session.end();
        throw new Error("That passkey opens a different Segundo account. Use the passkey you signed in with.");
      }
      spentAssertion.current = m.lastAssertion(r.credentialId);
      adopt(u);
    },
    [adopt],
  );

  const confirmWithPasskey = useCallback(
    async (reason: string) => {
      await check(reason);
      grant.current = Date.now() + FRESH_MS;
    },
    [check],
  );

  /** The AES key for sealed details: its own passkey prompt (a separate PRF salt), then kept until the session locks. */
  const sealingKey = useCallback(async (opts?: { fresh?: boolean }): Promise<CryptoKey> => {
    if (sealKey.current && !opts?.fresh) {
      lastActive.current = Date.now();
      return sealKey.current;
    }
    const r = recordRef.current;
    if (!r?.signedIn) throw new Error("Sign in with your passkey first.");
    if (!sealPending.current) {
      sealPending.current = (async () => {
        const m = meraModule ?? (await loadMera());
        const s = sealModule ?? (await loadSeal());
        const started = epoch.current;
        try {
          const key = await s.deriveSealingKey(await m.sealPrfOutput({ credentialId: r.credentialId, transports: r.transports }));
          if (epoch.current !== started) throw new Error("Signing was locked while the passkey prompt was open. Try again.");
          sealKey.current = key;
          lastActive.current = Date.now();
          return key;
        } catch (e) {
          throw new Error(m.meraMessage(e));
        } finally {
          sealPending.current = null;
        }
      })();
    }
    return sealPending.current;
  }, []);

  const signOut = useCallback(() => {
    lock();
    const r = recordRef.current;
    if (r) {
      // Keep the credential id and address so "Sign back in with your passkey" goes straight to the right passkey.
      const out = { ...r, signedIn: false };
      writeMera(out);
      recordRef.current = out;
      setRecord(out);
    }
  }, [lock]);

  // Idle and background limits for the in-memory key.
  useEffect(() => {
    const touch = () => {
      lastActive.current = Date.now();
    };
    let hiddenAt = 0;
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        hiddenTimer = setTimeout(lock, HIDDEN_MS);
      } else {
        clearTimeout(hiddenTimer);
        if (hiddenAt && Date.now() - hiddenAt > HIDDEN_MS) lock();
        hiddenAt = 0;
      }
    };
    const tick = setInterval(() => {
      if ((live.current || sealKey.current) && Date.now() - lastActive.current > IDLE_MS) lock();
    }, 30_000);
    window.addEventListener("pointerdown", touch, { passive: true });
    window.addEventListener("keydown", touch);
    window.addEventListener("pagehide", lock);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(tick);
      clearTimeout(hiddenTimer);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      window.removeEventListener("pagehide", lock);
      document.removeEventListener("visibilitychange", onVisibility);
      lock();
    };
  }, [lock]);

  const signedIn = !!record?.signedIn;
  return {
    loaded,
    signedIn,
    address: signedIn ? record!.address : undefined,
    credentialId: record?.credentialId,
    known: !!record,
    unlocked,
    unlock: async () => {
      await ensure();
    },
    signUp,
    signIn,
    signOut,
    lock,
    sealingKey,
    confirmWithPasskey,
    signTypedData: async (data: TypedDataDefinition) => {
      // Above $50 the session alone isn't enough: one fresh passkey check per transfer or permit (see PROMPT_FREE_UNITS).
      const reason = sensitiveReason(data);
      if (reason) {
        if (grant.current > Date.now()) grant.current = 0;
        else await check(reason);
      }
      const u = await ensure();
      try {
        return await u.account.signTypedData(data as never);
      } catch (e) {
        throw new Error((meraModule ?? (await loadMera())).meraMessage(e));
      }
    },
    signMessage: async (raw: Hex) => {
      const u = await ensure();
      try {
        return await u.account.signMessage({ message: { raw } });
      } catch (e) {
        throw new Error((meraModule ?? (await loadMera())).meraMessage(e));
      }
    },
  };
}

type MeraAccount = ReturnType<typeof useMeraAccount>;
type Practice = ReturnType<typeof usePracticeWallet>;
type Base = Pick<Wallet, "accounts" | "privyEnabled" | "signIn" | "usePractice">;

/** The wallet when someone is signed in with a passkey; `alsoOut` signs out of anything else (Privy, practice). */
function meraWallet(mera: MeraAccount, base: Base, alsoOut: () => void): Wallet {
  return {
    ...base,
    ready: true,
    address: mera.address,
    kind: "mera",
    label: "Passkey account",
    method: "passkey",
    passkeySignUp: mera.signUp,
    passkeySignIn: mera.signIn,
    hasPasskeyHere: true,
    unlocked: mera.unlocked,
    lock: mera.lock,
    unlock: mera.unlock,
    mera: { credentialId: mera.credentialId!, sealingKey: mera.sealingKey },
    confirmWithPasskey: mera.confirmWithPasskey,
    signOut: () => {
      mera.signOut();
      alsoOut();
    },
    signTypedData: mera.signTypedData,
    signMessage: mera.signMessage,
  };
}

/** Email (Privy) and practice wallets: no passkey to ask, so sensitive actions behave as before. */
const noPrompt = async (): Promise<void> => {};

const signInFirst = async (): Promise<never> => {
  throw new Error("Sign in first.");
};

/** Nobody signed in with a passkey or email: the practice wallet if it's on (full mode only), otherwise signed out. */
function signedOutWallet(practice: Practice | null, mera: MeraAccount, base: Base & { ready: boolean }): Wallet {
  const account = practice?.account ?? null;
  return {
    ...base,
    address: account?.address,
    kind: account ? "practice" : null,
    label: "Practice wallet",
    passkeySignUp: mera.signUp,
    passkeySignIn: mera.signIn,
    hasPasskeyHere: mera.known,
    unlocked: true,
    confirmWithPasskey: noPrompt,
    signOut: practice?.forget ?? (() => {}),
    signTypedData: account ? (data) => account.signTypedData(data) : signInFirst,
    signMessage: account ? (raw) => account.signMessage({ message: { raw } }) : signInFirst,
  };
}

/* ---------- Privy (email) ---------- */

/**
 * Privy's SDK (lib/privy-bridge.tsx) is a large chunk and opens an iframe, so it loads only when it's needed: when
 * someone picks "Continue with email" (Privy's window opens as soon as it's ready), or when this browser had an email
 * session before (the flag below, set while signed in with email and cleared on sign-out). Passkey and practice
 * sign-in never load it, and the passkey-only site never does either.
 */
const PRIVY_FLAG = "segundo:privy";
/** How long a queued email sign-in waits for Privy before giving up, so the buttons don't stay disabled. */
const LOGIN_WAIT_MS = 20_000;
type PrivyMountType = ComponentType<PrivyMountProps>;

let privyChunk: Promise<PrivyMountType> | null = null;
function loadPrivy(): Promise<PrivyMountType> {
  privyChunk ??= import("./privy-bridge")
    .then((m) => m.default)
    .catch((e) => {
      privyChunk = null;
      throw e;
    });
  return privyChunk;
}

function readPrivyFlag(): boolean {
  try {
    return localStorage.getItem(PRIVY_FLAG) === "1";
  } catch {
    return false;
  }
}

function writePrivyFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(PRIVY_FLAG, "1");
    else localStorage.removeItem(PRIVY_FLAG);
  } catch {}
}

const PRIVY_NOTE = "Your wallet is created and secured by Privy; Segundo pays the gas.";

export function WalletProvider({ children }: { children: ReactNode }) {
  const accounts = useAccountsMode();
  const full = accounts === "full";
  const withPrivy = full && !!PRIVY_APP_ID;
  const practice = usePracticeWallet();
  const mera = useMeraAccount(practice.forget);
  const [privy, setPrivy] = useState<PrivyState | null>(null);
  const calls = useRef<PrivyCalls | null>(null);
  /** Privy's component, once its chunk has loaded. */
  const [Mount, setMount] = useState<PrivyMountType | null>(null);
  /** Whether this browser had an email session (null until checked after mount): if so, wait for Privy before `ready`. */
  const [restore, setRestore] = useState<boolean | null>(null);
  const [wanted, setWanted] = useState(false);
  /** "Continue with email" was picked before Privy was ready: open its window once it is. */
  const [loginQueued, setLoginQueued] = useState(false);

  useEffect(() => {
    if (!withPrivy) return;
    const had = readPrivyFlag();
    setRestore(had);
    if (had) setWanted(true);
  }, [withPrivy]);

  useEffect(() => {
    if (!wanted || Mount) return;
    let stop = false;
    loadPrivy()
      .then((C) => {
        if (!stop) setMount(() => C);
      })
      .catch((e) => {
        console.warn("Privy failed to load", e);
        if (stop) return;
        setWanted(false);
        setRestore(false);
        setLoginQueued(false);
      });
    return () => {
      stop = true;
    };
  }, [wanted, Mount]);

  useEffect(() => {
    if (!loginQueued) return;
    if (privy?.ready && calls.current) {
      setLoginQueued(false);
      if (!privy.authenticated) calls.current.login();
      return;
    }
    const t = setTimeout(() => setLoginQueued(false), LOGIN_WAIT_MS);
    return () => clearTimeout(t);
  }, [loginQueued, privy]);

  // Remember an email session so the next visit loads Privy straight away; forget it once Privy says signed out.
  const privyReady = !!privy?.ready;
  const privyAuthed = !!privy?.authenticated;
  useEffect(() => {
    if (privyReady) writePrivyFlag(privyAuthed);
  }, [privyReady, privyAuthed]);

  const value = useMemo<Wallet>(() => {
    const emailSignIn = () => {
      const c = calls.current;
      if (privy?.ready && c) return c.login();
      setWanted(true);
      setLoginQueued(true);
    };
    const base: Base = {
      accounts,
      privyEnabled: withPrivy,
      signIn: withPrivy ? emailSignIn : full ? practice.create : () => {},
      usePractice: full ? practice.create : () => {},
    };
    const privyOut = () => {
      if (privy?.authenticated) {
        writePrivyFlag(false);
        void calls.current?.logout();
      }
    };
    if (mera.signedIn)
      return meraWallet(mera, base, () => {
        practice.forget();
        privyOut();
      });
    if (withPrivy && privy?.authenticated && privy.address) {
      const address = privy.address;
      const client = async () => {
        const c = calls.current;
        if (!c) throw new Error("Sign in first.");
        return createWalletClient({ account: address, chain: monadTestnet, transport: custom(await c.provider()) });
      };
      return {
        ...base,
        ready: true,
        address,
        kind: "privy",
        label: privy.email ?? "Signed in",
        method: "email",
        note: PRIVY_NOTE,
        exportKey: async () => calls.current?.exportKey(),
        passkeySignUp: mera.signUp,
        passkeySignIn: mera.signIn,
        hasPasskeyHere: mera.known,
        unlocked: true,
        confirmWithPasskey: noPrompt,
        signOut: () => {
          practice.forget();
          privyOut();
        },
        signTypedData: async (data) => (await client()).signTypedData(data as never),
        signMessage: async (raw) => (await client()).signMessage({ message: { raw } }),
      };
    }
    if (full) {
      // Without an email session to restore, Privy isn't loaded and holds nothing up. With one (or while an email
      // sign-in waits for Privy), wait for it; signed in but the embedded wallet still being made: not ready, as before.
      const privySettled =
        !withPrivy || (restore !== null && !loginQueued && (privy?.ready ? !privy.authenticated || !!privy.address : !restore));
      return signedOutWallet(practice, mera, { ...base, ready: privySettled && practice.loaded && mera.loaded });
    }
    // Passkey only: never the practice wallet, even if this browser kept one from the full site.
    return signedOutWallet(null, mera, { ...base, ready: accounts === "mera" && mera.loaded });
  }, [accounts, full, withPrivy, privy, practice, mera, restore, loginQueued]);

  return (
    <>
      <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
      {withPrivy && Mount && <Mount appId={PRIVY_APP_ID!} onState={setPrivy} calls={calls} />}
    </>
  );
}

export function useWallet(): Wallet {
  const w = useContext(WalletContext);
  if (!w) throw new Error("useWallet outside WalletProvider");
  return w;
}
