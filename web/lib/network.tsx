"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Address } from "viem";
import type { Profile, TabView } from "./tabs";

export type Payout = { id: string; payee: string; amount: string; block: number; time: number; hash: string };

export type Network = {
  ok: boolean;
  tabs: number;
  running: number;
  earned: bigint;
  paid: bigint;
  block: number;
  featured: TabView | null;
  open: TabView[];
  recent: Payout[];
  profiles: Record<string, Profile>;
};

type Raw = Record<string, unknown>;
const big = (v: unknown) => BigInt((v as string) ?? "0");

/** /api/live sends bigints as strings; turn a tab back into bigints. */
export function reviveTab(f: Raw): TabView {
  const t = f.tab as Raw;
  return {
    id: big(f.id),
    earned: big(f.earned),
    owed: big(f.owed),
    runway: big(f.runway),
    tab: {
      payer: t.payer as Address,
      payee: t.payee as Address,
      invite: t.invite as Address,
      rate: big(t.rate),
      held: t.held as boolean,
      closed: t.closed as boolean,
      since: big(t.since),
      lastBlock: big(t.lastBlock),
      budget: big(t.budget),
      banked: big(t.banked),
      paid: big(t.paid),
    },
  };
}

const NetworkContext = createContext<Network | null | undefined>(undefined);

/** One poll of /api/live for the whole page (every 4 s while visible), shared by every live section. */
export function NetworkProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Network | null | undefined>(undefined);
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/live")
        .then((r) => r.json())
        .then((d: Raw) => {
          if (stop) return;
          if (d.tabs == null) return setData((old) => old ?? null);
          setData({
            ok: true,
            tabs: d.tabs as number,
            running: d.running as number,
            earned: big(d.earned),
            paid: big(d.paid),
            block: d.block as number,
            featured: d.featured ? reviveTab(d.featured as Raw) : null,
            open: ((d.open as Raw[]) ?? []).map(reviveTab),
            recent: (d.recent as Payout[]) ?? [],
            profiles: (d.profiles as Record<string, Profile>) ?? {},
          });
        })
        .catch(() => !stop && setData((old) => old ?? null));
    // Skips its turn while the tab is hidden, and reads again as soon as it is visible.
    const onVisibility = () => !document.hidden && load();
    if (!document.hidden) load();
    const t = setInterval(() => !document.hidden && load(), 4000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return <NetworkContext.Provider value={data}>{children}</NetworkContext.Provider>;
}

/** undefined while loading, null if the RPC is unavailable. */
export const useNetwork = () => useContext(NetworkContext);
