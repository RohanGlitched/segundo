"use client";

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { publicClient } from "./chain";
import { noteRpcError, noteRpcOk, rpcResting } from "./hooks";
import type { Rates } from "./money";

type Head = { number: number; timestamp: number; receivedAt: number };
type Live = { head: Head | null; rates: Rates | null; ratesUpdated: string | null };
type RatesOnly = { rates: Rates | null; ratesUpdated: string | null };

/** Rates change once per page load; the block head lives in its own store so rate-only readers don't re-render per block. */
const RatesContext = createContext<RatesOnly>({ rates: null, ratesUpdated: null });
/** False inside a subtree that is off-screen: its live readers stop subscribing to blocks and the clock. */
const LiveActiveContext = createContext(true);
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "wss://testnet-rpc.monad.xyz";

const noopSubscribe = () => () => {};
const hidden = () => typeof document !== "undefined" && document.hidden;

// ---- block head store
let headNow: Head | null = null;
const headSubs = new Set<() => void>();
const subscribeHead = (f: () => void) => {
  headSubs.add(f);
  return () => {
    headSubs.delete(f);
  };
};
const getHead = () => headNow;
const getServerHead = () => null;
function publishHead(h: Head) {
  headNow = h;
  headSubs.forEach((f) => f());
}

// ---- one shared chain clock: whole seconds, re-rendering its readers once a second, stopped while the tab is hidden
const computeNow = () => (headNow ? Math.floor(headNow.timestamp + (Date.now() - headNow.receivedAt) / 1000) : Math.floor(Date.now() / 1000));
let clockNow = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;
const clockSubs = new Set<() => void>();
function tickClock() {
  const n = computeNow();
  if (n === clockNow) return;
  clockNow = n;
  clockSubs.forEach((f) => f());
}
function runClock() {
  const want = clockSubs.size > 0 && !hidden();
  if (want && !clockTimer) {
    tickClock();
    // Checked twice a second, but readers only re-render when the whole second changes.
    clockTimer = setInterval(tickClock, 500);
  } else if (!want && clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
}
if (typeof document !== "undefined") document.addEventListener("visibilitychange", runClock);
const subscribeClock = (f: () => void) => {
  clockSubs.add(f);
  runClock();
  return () => {
    clockSubs.delete(f);
    runClock();
  };
};
const getClock = () => {
  if (!clockNow) clockNow = computeNow();
  return clockNow;
};

/**
 * Follows Monad's blocks as they are produced (a newHeads subscription, roughly 2.5 a second),
 * falling back to polling if the socket can't open (polls skip their turn while the RPC is rate-limiting us, see
 * lib/hooks.ts). Also loads reference exchange rates once. The socket closes while the tab is hidden.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [rates, setRates] = useState<RatesOnly>({ rates: null, ratesUpdated: null });
  const last = useRef(0);

  useEffect(() => {
    fetch("/api/fx")
      .then((r) => r.json())
      .then((d) => setRates({ rates: d.rates, ratesUpdated: d.updated }))
      .catch(() => setRates({ rates: null, ratesUpdated: null }));
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let failures = 0;

    const accept = (number: number, timestamp: number) => {
      if (number <= last.current) return;
      last.current = number;
      publishHead({ number, timestamp, receivedAt: Date.now() });
    };

    const startPolling = () => {
      if (poll) return;
      const tick = () =>
        !rpcResting() &&
        publicClient
          .getBlock()
          .then((b) => {
            noteRpcOk();
            accept(Number(b.number), Number(b.timestamp));
          })
          .catch(noteRpcError);
      tick();
      poll = setInterval(tick, 1000);
    };

    const connect = () => {
      retry = null;
      if (closed || !WS_URL || hidden()) return;
      let sock: WebSocket;
      try {
        sock = new WebSocket(WS_URL);
      } catch {
        startPolling();
        return;
      }
      ws = sock;
      sock.onopen = () => {
        failures = 0;
        sock.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newHeads"] }));
      };
      sock.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string);
          const h = msg?.params?.result;
          if (h?.number) {
            accept(parseInt(h.number, 16), parseInt(h.timestamp, 16));
            if (poll) {
              clearInterval(poll);
              poll = null;
            }
          }
        } catch {}
      };
      sock.onclose = () => {
        if (closed || ws !== sock) return;
        ws = null;
        failures++;
        startPolling();
        retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** failures));
      };
      sock.onerror = () => sock.close();
    };

    // While the tab is hidden: no socket, no polling. Back on screen: one read straight away, then the socket.
    const pause = () => {
      if (poll) clearInterval(poll);
      poll = null;
      if (retry) clearTimeout(retry);
      retry = null;
      const sock = ws;
      ws = null;
      if (sock) {
        sock.onclose = null;
        sock.onerror = null;
        sock.onmessage = null;
        try {
          sock.close();
        } catch {}
      }
    };
    const resume = () => {
      if (ws || poll || retry) return;
      failures = 0;
      startPolling();
      connect();
    };
    const onVisibility = () => (hidden() ? pause() : resume());

    if (!hidden()) resume();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      pause();
    };
  }, []);

  return <RatesContext.Provider value={rates}>{children}</RatesContext.Provider>;
}

/** Marks a subtree as on or off screen; live readers inside it stop updating while it is off. */
export function LiveActive({ active, children }: { active: boolean; children: ReactNode }) {
  return <LiveActiveContext.Provider value={active}>{children}</LiveActiveContext.Provider>;
}

/** The latest Monad block, re-rendering on every block (about 2.5 a second). */
export function useHead(): Head | null {
  const active = useContext(LiveActiveContext);
  return useSyncExternalStore(active ? subscribeHead : noopSubscribe, getHead, getServerHead);
}

/** The latest block without subscribing to it (read during an update that happens anyway). */
export const peekHead = () => headNow;

/** Reference exchange rates only: never re-renders for blocks. */
export const useRates = () => useContext(RatesContext);

/** Rates and the latest block (re-renders on every block; use useRates when the block isn't shown). */
export function useLive(): Live {
  const { rates, ratesUpdated } = useContext(RatesContext);
  const head = useHead();
  return { head, rates, ratesUpdated };
}

/** Chain time in whole seconds, advanced locally between blocks; one shared 1 Hz clock that stops while the tab is hidden. */
export function useChainNow(): number {
  const active = useContext(LiveActiveContext);
  return useSyncExternalStore(active ? subscribeClock : noopSubscribe, getClock, getClock);
}

/** True while the element is on (or near) the screen and the tab is visible. */
export function useOnScreen<T extends Element>(ref: RefObject<T | null>, margin = "200px"): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let inView = true;
    const update = () => setOn(inView && !document.hidden);
    const io = new IntersectionObserver(([e]) => {
      inView = !!e?.isIntersecting;
      update();
    }, { rootMargin: margin });
    io.observe(el);
    document.addEventListener("visibilitychange", update);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [ref, margin]);
  return on;
}
