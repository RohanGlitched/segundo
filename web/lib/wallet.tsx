"use client";

import { PrivyProvider, useCreateWallet, useExportWallet, usePrivy, useWallets, type EIP1193Provider, type PrivyClientConfig } from "@privy-io/react-auth";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createWalletClient, custom, type Address, type Hex, type TypedDataDefinition } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "./chain";
import type { MeraUnlocked } from "./mera";

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
  /** Mera only: the passkey behind the account and its sealing key for private details (lib/seal.ts). */
  mera?: { credentialId: string; sealingKey: () => Promise<CryptoKey> };
  usePractice: () => void;
  signOut: () => void;
  signTypedData: (data: TypedDataDefinition) => Promise<Hex>;
  signMessage: (raw: Hex) => Promise<Hex>;
};

export type AccountsMode = "full" | "mera" | "pending";

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
    signOut: () => {
      mera.signOut();
      alsoOut();
    },
    signTypedData: mera.signTypedData,
    signMessage: mera.signMessage,
  };
}

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
    signOut: practice?.forget ?? (() => {}),
    signTypedData: account ? (data) => account.signTypedData(data) : signInFirst,
    signMessage: account ? (raw) => account.signMessage({ message: { raw } }) : signInFirst,
  };
}

/* ---------- Privy (email) ---------- */

/** What the page needs to know about the Privy session: plain values, so changes are cheap to compare. */
type PrivyState = { ready: boolean; authenticated: boolean; address?: Address; email?: string };
/** The latest Privy actions, kept in a ref so the wallet always calls the current ones. */
type PrivyCalls = { login: () => void; logout: () => Promise<void>; provider: () => Promise<EIP1193Provider>; exportKey: () => Promise<void> };

// Kept outside the component: a new config object on every render would make Privy start over.
const PRIVY_CONFIG: PrivyClientConfig = {
  // Passkeys go through Mera (one passkey story); Privy is the email way in and its embedded wallet. Email is also
  // how money reaches someone who isn't on Segundo yet: app/api/recipient makes their wallet ahead of time.
  loginMethods: ["email"],
  appearance: { theme: "light", accentColor: "#17332B", landingHeader: "Sign in to Segundo", showWalletLoginFirst: false },
  embeddedWallets: { ethereum: { createOnLogin: "all-users" }, showWalletUIs: false },
  defaultChain: monadTestnet,
  supportedChains: [monadTestnet],
};

/** Reads the Privy session and reports it up; renders nothing. */
function PrivyBridge({ onState, calls }: { onState: (s: PrivyState) => void; calls: RefObject<PrivyCalls | null> }) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const { exportWallet } = useExportWallet();
  const creating = useRef(false);
  const embedded = wallets.find((w) => w.walletClientType === "privy");

  // Make sure every email user has an embedded wallet (people sent money by email already have one, made in advance).
  useEffect(() => {
    if (!ready || !authenticated || !walletsReady || embedded || creating.current) return;
    creating.current = true;
    createWallet()
      .catch((e) => console.warn("createWallet", e))
      .finally(() => {
        creating.current = false;
      });
  }, [ready, authenticated, walletsReady, embedded, createWallet]);

  useEffect(() => {
    calls.current = {
      login,
      logout,
      provider: () => (embedded ? embedded.getEthereumProvider() : Promise.reject(new Error("Sign in first."))),
      exportKey: () => (embedded ? exportWallet({ address: embedded.address }) : Promise.reject(new Error("Sign in first."))),
    };
  });

  const address = embedded?.address as Address | undefined;
  const email = user?.email?.address ?? user?.google?.email;
  useEffect(() => {
    onState({ ready, authenticated, address, email });
  }, [onState, ready, authenticated, address, email]);
  return null;
}

/**
 * Privy sits beside the page rather than around it, so it can be left out (passkey-only mode) or added once the mode
 * is known without remounting the page. Its sign-in window is a fixed overlay, so its place in the tree doesn't matter.
 */
const PrivyMount = memo(function PrivyMount(props: { onState: (s: PrivyState) => void; calls: RefObject<PrivyCalls | null> }) {
  return (
    <PrivyProvider appId={PRIVY_APP_ID!} config={PRIVY_CONFIG}>
      <PrivyBridge {...props} />
    </PrivyProvider>
  );
});

const PRIVY_NOTE = "Your wallet is created and secured by Privy; Segundo pays the gas.";

export function WalletProvider({ children }: { children: ReactNode }) {
  const accounts = useAccountsMode();
  const full = accounts === "full";
  const withPrivy = full && !!PRIVY_APP_ID;
  const practice = usePracticeWallet();
  const mera = useMeraAccount(practice.forget);
  const [privy, setPrivy] = useState<PrivyState | null>(null);
  const calls = useRef<PrivyCalls | null>(null);

  const value = useMemo<Wallet>(() => {
    const base: Base = {
      accounts,
      privyEnabled: withPrivy,
      signIn: withPrivy ? () => calls.current?.login() : full ? practice.create : () => {},
      usePractice: full ? practice.create : () => {},
    };
    const privyOut = () => {
      if (privy?.authenticated) void calls.current?.logout();
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
        signOut: () => {
          practice.forget();
          privyOut();
        },
        signTypedData: async (data) => (await client()).signTypedData(data as never),
        signMessage: async (raw) => (await client()).signMessage({ message: { raw } }),
      };
    }
    if (full) {
      // Signed in with email but the embedded wallet isn't there yet (it's being made): not ready, as before.
      const privySettled = !withPrivy || (!!privy?.ready && (!privy.authenticated || !!privy.address));
      return signedOutWallet(practice, mera, { ...base, ready: privySettled && practice.loaded && mera.loaded });
    }
    // Passkey only: never the practice wallet, even if this browser kept one from the full site.
    return signedOutWallet(null, mera, { ...base, ready: accounts === "mera" && mera.loaded });
  }, [accounts, full, withPrivy, privy, practice, mera]);

  return (
    <>
      <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
      {withPrivy && <PrivyMount onState={setPrivy} calls={calls} />}
    </>
  );
}

export function useWallet(): Wallet {
  const w = useContext(WalletContext);
  if (!w) throw new Error("useWallet outside WalletProvider");
  return w;
}
