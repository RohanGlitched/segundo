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
/** How long a block reader must stay mounted before the socket opens, and how long it stays open after the last one goes. */
const OPEN_DELAY_MS = 250;
const CLOSE_GRACE_MS = 5000;

const noopSubscribe = () => () => {};
const hidden = () => typeof document !== "undefined" && document.hidden;

// ---- who wants blocks: the socket runs only while something on screen reads them
/**
 * Mounted block readers (useHead, useLive's head, useChainNow) are counted through their store subscriptions, so
 * pages that show no block data never open the socket. peekHead() also counts for a few seconds after each call, for
 * readers that sample the head on their own timer.
 */
const PEEK_MS = 4000;
let peekUntil = 0;
let onDemand: (() => void) | null = null;
const demandChanged = () => onDemand?.();
const blockReaders = () => headSubs.size + clockSubs.size;

// ---- block head store
let headNow: Head | null = null;
const headSubs = new Set<() => void>();
const subscribeHead = (f: () => void) => {
  headSubs.add(f);
  demandChanged();
  return () => {
    headSubs.delete(f);
    demandChanged();
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
  demandChanged();
  return () => {
    clockSubs.delete(f);
    runClock();
    demandChanged();
  };
};
const getClock = () => {
  if (!clockNow) clockNow = computeNow();
  return clockNow;
};

/**
 * Follows Monad's blocks as they are produced (a newHeads subscription, roughly 2.5 a second),
 * falling back to polling if the socket can't open (polls skip their turn while the RPC is rate-limiting us, see
 * lib/hooks.ts). Also loads reference exchange rates once. The socket is open only while the tab is visible and a
 * block reader is mounted (see "who wants blocks" above), so pages that show no block data hold no socket.
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

    // Run only while the tab is visible and a block reader is mounted. Opening waits a moment (readers that start
    // off-screen unsubscribe as soon as their observer reports), and closing waits a few seconds so moving between
    // pages, or a reader remounting, doesn't drop and reopen the socket.
    let running = false;
    let startTimer: ReturnType<typeof setTimeout> | null = null;
    let stopTimer: ReturnType<typeof setTimeout> | null = null;
    let peekTimer: ReturnType<typeof setTimeout> | null = null;
    const clear = (t: ReturnType<typeof setTimeout> | null) => {
      if (t) clearTimeout(t);
    };
    const wanted = () => !hidden() && (blockReaders() > 0 || Date.now() < peekUntil);
    const stop = () => {
      if (!running) return;
      running = false;
      pause();
    };
    const evaluate = () => {
      if (closed) return;
      clear(peekTimer);
      peekTimer = null;
      if (hidden()) {
        clear(startTimer);
        clear(stopTimer);
        startTimer = stopTimer = null;
        stop();
        return;
      }
      if (wanted()) {
        clear(stopTimer);
        stopTimer = null;
        if (!running && !startTimer)
          startTimer = setTimeout(() => {
            startTimer = null;
            if (closed || running || !wanted()) return;
            running = true;
            resume();
          }, OPEN_DELAY_MS);
        // Wanted only because of a recent peek: look again when it runs out.
        if (!blockReaders()) peekTimer = setTimeout(evaluate, Math.max(0, peekUntil - Date.now()) + 50);
      } else {
        clear(startTimer);
        startTimer = null;
        if (running && !stopTimer)
          stopTimer = setTimeout(() => {
            stopTimer = null;
            if (!closed && !wanted()) stop();
          }, CLOSE_GRACE_MS);
      }
    };

    onDemand = evaluate;
    evaluate();
    document.addEventListener("visibilitychange", evaluate);
    return () => {
      closed = true;
      if (onDemand === evaluate) onDemand = null;
      document.removeEventListener("visibilitychange", evaluate);
      clear(startTimer);
      clear(stopTimer);
      clear(peekTimer);
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

/** The latest block without subscribing to it (read during an update that happens anyway). Keeps blocks coming for a few seconds. */
export const peekHead = () => {
  if (typeof window !== "undefined") {
    const fresh = Date.now() >= peekUntil;
    peekUntil = Date.now() + PEEK_MS;
    if (fresh) demandChanged();
  }
  return headNow;
};

/** Reference exchange rates only: never re-renders for blocks. */
export const useRates = () => useContext(RatesContext);

/**
 * Rates and the latest block. Only a component that reads `head` follows blocks (and re-renders on each one); one
 * that takes just the rates, as in `const { rates } = useLive()`, never subscribes, so it keeps no socket open.
 */
export function useLive(): Live {
  const { rates, ratesUpdated } = useContext(RatesContext);
  const active = useContext(LiveActiveContext);
  const readsHead = useRef(false);
  const [follow, setFollow] = useState(false);
  const head = useSyncExternalStore(active && follow ? subscribeHead : noopSubscribe, getHead, getServerHead);
  // `head` was read during a render: from now on, re-render on every block.
  useEffect(() => {
    if (readsHead.current && !follow) setFollow(true);
  });
  return {
    get head() {
      readsHead.current = true;
      return head;
    },
    rates,
    ratesUpdated,
  };
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
