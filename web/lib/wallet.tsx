"use client";

import { PrivyProvider, useCreateWallet, useLoginWithPasskey, usePrivy, useSignupWithPasskey, useWallets } from "@privy-io/react-auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createWalletClient, custom, type Address, type Hex, type TypedDataDefinition } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "./chain";

/**
 * One wallet interface for the app. People sign in with a passkey or an email through Privy (an embedded wallet,
 * no seed phrase, no gas), or start instantly with a practice wallet kept in this browser.
 * Till never asks either one to pay gas: every action is a signature the relayer submits.
 */
export type Wallet = {
  ready: boolean;
  address?: Address;
  kind: "privy" | "practice" | null;
  label: string;
  /** How a Privy user signed in. */
  method?: "passkey" | "email";
  privyEnabled: boolean;
  signIn: () => void;
  /** Passkey onboarding (Privy): create an account with a device passkey, or sign back in with it. */
  passkeySignUp?: () => Promise<void>;
  passkeySignIn?: () => Promise<void>;
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

function PracticeOnly({ children }: { children: ReactNode }) {
  const practice = usePracticeWallet();
  const value = useMemo<Wallet>(
    () => ({
      ready: practice.loaded,
      address: practice.account?.address,
      kind: practice.account ? "practice" : null,
      label: "Practice wallet",
      privyEnabled: false,
      signIn: practice.create,
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
    }),
    [practice],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

function WithPrivy({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const practice = usePracticeWallet();
  const { signupWithPasskey } = useSignupWithPasskey();
  const { loginWithPasskey } = useLoginWithPasskey();
  const { createWallet } = useCreateWallet();
  const creating = useRef(false);
  const embedded = wallets.find((w) => w.walletClientType === "privy");

  // Make sure every signed-in user has an embedded wallet, however they signed up (passkey, email).
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
  const viaPasskey = !email && !!user?.linkedAccounts.some((a) => a.type === "passkey");

  const value = useMemo<Wallet>(() => {
    if (authenticated && embedded) {
      const client = async () =>
        createWalletClient({
          account: embedded.address as Address,
          chain: monadTestnet,
          transport: custom(await embedded.getEthereumProvider()),
        });
      return {
        ready: true,
        address: embedded.address as Address,
        kind: "privy",
        label: email ?? (viaPasskey ? "Passkey account" : "Signed in"),
        method: viaPasskey ? "passkey" : "email",
        privyEnabled: true,
        signIn: login,
        passkeySignUp: () => signupWithPasskey(),
        passkeySignIn: () => loginWithPasskey(),
        usePractice: practice.create,
        signOut: () => {
          practice.forget();
          void logout();
        },
        signTypedData: async (data) => (await client()).signTypedData(data as never),
        signMessage: async (raw) => (await client()).signMessage({ message: { raw } }),
      };
    }
    return {
      ready: ready && practice.loaded && (!authenticated || !!embedded),
      address: practice.account?.address,
      kind: practice.account ? "practice" : null,
      label: "Practice wallet",
      privyEnabled: true,
      signIn: login,
      passkeySignUp: () => signupWithPasskey(),
      passkeySignIn: () => loginWithPasskey(),
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
  }, [authenticated, embedded, email, viaPasskey, login, logout, practice, ready, signupWithPasskey, loginWithPasskey]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) return <PracticeOnly>{children}</PracticeOnly>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["passkey", "email"],
        appearance: { theme: "light", accentColor: "#17332B", landingHeader: "Sign in to Till", showWalletLoginFirst: false },
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
