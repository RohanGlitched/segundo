"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { publicClient } from "./chain";
import { noteRpcError, noteRpcOk, rpcResting } from "./hooks";
import type { Rates } from "./money";

type Head = { number: number; timestamp: number; receivedAt: number };
type Live = { head: Head | null; rates: Rates | null; ratesUpdated: string | null };

const LiveContext = createContext<Live>({ head: null, rates: null, ratesUpdated: null });
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "wss://testnet-rpc.monad.xyz";

/**
 * Follows Monad's blocks as they are produced (a newHeads subscription, roughly 2.5 a second),
 * falling back to polling if the socket can't open (polls skip their turn while the RPC is rate-limiting us, see
 * lib/hooks.ts). Also loads reference exchange rates once.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [head, setHead] = useState<Head | null>(null);
  const [rates, setRates] = useState<{ rates: Rates | null; updated: string | null }>({ rates: null, updated: null });
  const last = useRef(0);

  useEffect(() => {
    fetch("/api/fx")
      .then((r) => r.json())
      .then((d) => setRates({ rates: d.rates, updated: d.updated }))
      .catch(() => setRates({ rates: null, updated: null }));
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
      setHead({ number, timestamp, receivedAt: Date.now() });
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
      if (closed || !WS_URL) return;
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        startPolling();
        return;
      }
      ws.onopen = () => {
        failures = 0;
        ws?.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newHeads"] }));
      };
      ws.onmessage = (ev) => {
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
      ws.onclose = () => {
        if (closed) return;
        failures++;
        startPolling();
        retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** failures));
      };
      ws.onerror = () => ws?.close();
    };

    startPolling();
    connect();
    return () => {
      closed = true;
      ws?.close();
      if (poll) clearInterval(poll);
      if (retry) clearTimeout(retry);
    };
  }, []);

  return <LiveContext.Provider value={{ head, rates: rates.rates, ratesUpdated: rates.updated }}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);

/** Chain time in seconds, advanced locally between blocks so per-second pay ticks smoothly. */
export function useChainNow(): number {
  const { head } = useLive();
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  if (!head) return Math.floor(Date.now() / 1000);
  return Math.floor(head.timestamp + (Date.now() - head.receivedAt) / 1000);
}
