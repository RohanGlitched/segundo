"use client";

import { PrivyProvider, useCreateWallet, useExportWallet, usePrivy, useWallets, type EIP1193Provider, type PrivyClientConfig } from "@privy-io/react-auth";
import { memo, useEffect, useRef, type RefObject } from "react";
import type { Address } from "viem";
import { monadTestnet } from "./chain";

/**
 * Privy (email sign-in and its embedded wallet), in its own chunk. lib/wallet.tsx imports this file only when
 * someone picks "Continue with email" or this browser had an email session before, so passkey and practice
 * visitors never download Privy's SDK or open its iframe.
 */

/** What the page needs to know about the Privy session: plain values, so changes are cheap to compare. */
export type PrivyState = { ready: boolean; authenticated: boolean; address?: Address; email?: string };
/** The latest Privy actions, kept in a ref so the wallet always calls the current ones. */
export type PrivyCalls = { login: () => void; logout: () => Promise<void>; provider: () => Promise<EIP1193Provider>; exportKey: () => Promise<void> };
export type PrivyMountProps = { appId: string; onState: (s: PrivyState) => void; calls: RefObject<PrivyCalls | null> };

// Kept outside the component: a new config object on every render would make Privy start over.
const PRIVY_CONFIG: PrivyClientConfig = {
  // Passkeys go through Mera (one passkey story); Privy is the email way in and its embedded wallet. Email is also
  // how money reaches someone who isn't on Segundo yet: app/api/recipient makes their wallet ahead of time.
  loginMethods: ["email"],
  // Email only, so no external wallets: an empty wallet list and WalletConnect switched off keep Privy from fetching
  // the WalletConnect registry and starting its connectors.
  appearance: { theme: "light", accentColor: "#17332B", landingHeader: "Sign in to Segundo", showWalletLoginFirst: false, walletList: [] },
  externalWallets: { walletConnect: { enabled: false }, disableAllExternalWallets: true },
  embeddedWallets: { ethereum: { createOnLogin: "all-users" }, showWalletUIs: false },
  defaultChain: monadTestnet,
  supportedChains: [monadTestnet],
};

/** Reads the Privy session and reports it up; renders nothing. */
function PrivyBridge({ onState, calls }: Omit<PrivyMountProps, "appId">) {
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
 * Privy sits beside the page rather than around it, so it can be added once it's wanted without remounting the
 * page. Its sign-in window is a fixed overlay, so its place in the tree doesn't matter.
 */
const PrivyMount = memo(function PrivyMount({ appId, ...props }: PrivyMountProps) {
  return (
    <PrivyProvider appId={appId} config={PRIVY_CONFIG}>
      <PrivyBridge {...props} />
    </PrivyProvider>
  );
});

export default PrivyMount;
