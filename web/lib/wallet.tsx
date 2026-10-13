"use client";

import { PrivyProvider, useCreateWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createWalletClient, custom, type Address, type Hex, type TypedDataDefinition } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "./chain";
import type { MeraUnlocked } from "./mera";

/**
 * One wallet interface for the app. The main way in is a passkey account made with Mera: the passkey's PRF output
 * becomes the account key in this browser, no seed phrase, no server holding anything. Email through Privy (an
 * embedded wallet) stays as the second way in, and a practice wallet kept in this browser is the quick last option.
 * Segundo never asks any of them to pay gas: every action is a signature the relayer submits.
 */
export type Wallet = {
  ready: boolean;
  address?: Address;
  kind: "mera" | "privy" | "practice" | null;
  label: string;
  /** How the person signed in: a passkey (Mera) or email (Privy). */
  method?: "passkey" | "email";
  privyEnabled: boolean;
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
  /** Mera only: the passkey behind the account and its sealing key for private details (lib/seal.ts). */
  mera?: { credentialId: string; sealingKey: () => Promise<CryptoKey> };
  usePractice: () => void;
  signOut: () => void;
  signTypedData: (data: TypedDataDefinition) => Promise<Hex>;
  signMessage: (raw: Hex) => Promise<Hex>;
};

const WalletContext = createContext<Wallet | null>(null);
const PRACTICE_KEY = "till.practice.v1";
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

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

  /** The AES key for sealed details: its own passkey prompt (a separate PRF salt), then kept until the session locks. */
  const sealingKey = useCallback(async (): Promise<CryptoKey> => {
    if (sealKey.current) {
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
    signTypedData: async (data: TypedDataDefinition) => {
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

/** The wallet when someone is signed in with a passkey; `alsoOut` signs out of anything else (Privy, practice). */
function meraWallet(mera: MeraAccount, base: Pick<Wallet, "privyEnabled" | "signIn" | "usePractice">, alsoOut: () => void): Wallet {
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
    signOut: () => {
      mera.signOut();
      alsoOut();
    },
    signTypedData: mera.signTypedData,
    signMessage: mera.signMessage,
  };
}

/** Nobody signed in with a passkey or email: the practice wallet if it's on, otherwise signed out. */
function practiceWallet(practice: Practice, mera: MeraAccount, base: Pick<Wallet, "privyEnabled" | "signIn" | "ready">): Wallet {
  return {
    ...base,
    address: practice.account?.address,
    kind: practice.account ? "practice" : null,
    label: "Practice wallet",
    passkeySignUp: mera.signUp,
    passkeySignIn: mera.signIn,
    hasPasskeyHere: mera.known,
    unlocked: true,
    usePractice: practice.create,
    signOut: practice.forget,
    signTypedData: async (data) => {
      if (!practice.account) throw new Error("Sign in first.");
      return practice.account.signTypedData(data);
    },
    signMessage: async (raw) => {
      if (!practice.account) throw new Error("Sign in first.");
      return practice.account.signMessage({ message: { raw } });
    },
  };
}

function PracticeOnly({ children }: { children: ReactNode }) {
  const practice = usePracticeWallet();
  const mera = useMeraAccount(practice.forget);
  const value = useMemo<Wallet>(() => {
    if (mera.signedIn) return meraWallet(mera, { privyEnabled: false, signIn: practice.create, usePractice: practice.create }, practice.forget);
    return practiceWallet(practice, mera, { privyEnabled: false, signIn: practice.create, ready: practice.loaded && mera.loaded });
  }, [practice, mera]);
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

function WithPrivy({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const practice = usePracticeWallet();
  const mera = useMeraAccount(practice.forget);
  const { createWallet } = useCreateWallet();
  const creating = useRef(false);
  const embedded = wallets.find((w) => w.walletClientType === "privy");

  // Make sure every email user has an embedded wallet.
  useEffect(() => {
    if (!ready || !authenticated || !walletsReady || embedded || creating.current) return;
    creating.current = true;
    createWallet()
      .catch((e) => console.warn("createWallet", e))
      .finally(() => {
        creating.current = false;
      });
  }, [ready, authenticated, walletsReady, embedded, createWallet]);
  const email = user?.email?.address ?? user?.google?.email;

  const value = useMemo<Wallet>(() => {
    const base = { privyEnabled: true, signIn: login, usePractice: practice.create };
    if (mera.signedIn)
      return meraWallet(mera, base, () => {
        practice.forget();
        if (authenticated) void logout();
      });
    if (authenticated && embedded) {
      const client = async () =>
        createWalletClient({
          account: embedded.address as Address,
          chain: monadTestnet,
          transport: custom(await embedded.getEthereumProvider()),
        });
      return {
        ...base,
        ready: true,
        address: embedded.address as Address,
        kind: "privy",
        label: email ?? "Signed in",
        method: "email",
        passkeySignUp: mera.signUp,
        passkeySignIn: mera.signIn,
        hasPasskeyHere: mera.known,
        unlocked: true,
        signOut: () => {
          practice.forget();
          void logout();
        },
        signTypedData: async (data) => (await client()).signTypedData(data as never),
        signMessage: async (raw) => (await client()).signMessage({ message: { raw } }),
      };
    }
    return practiceWallet(practice, mera, {
      privyEnabled: true,
      signIn: login,
      ready: ready && practice.loaded && mera.loaded && (!authenticated || !!embedded),
    });
  }, [authenticated, embedded, email, login, logout, practice, ready, mera]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) return <PracticeOnly>{children}</PracticeOnly>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Passkeys go through Mera (one passkey story); Privy is the email way in and its embedded wallet.
        loginMethods: ["email"],
        appearance: { theme: "light", accentColor: "#17332B", landingHeader: "Continue with email", showWalletLoginFirst: false },
        embeddedWallets: { ethereum: { createOnLogin: "all-users" }, showWalletUIs: false },
        defaultChain: monadTestnet,
        supportedChains: [monadTestnet],
      }}
    >
      <WithPrivy>{children}</WithPrivy>
    </PrivyProvider>
  );
}

export function useWallet(): Wallet {
  const w = useContext(WalletContext);
  if (!w) throw new Error("useWallet outside WalletProvider");
  return w;
}
