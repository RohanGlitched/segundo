import "server-only";
import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  decodeErrorResult,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tillAbi } from "./abi";
import { RPC_URL, TILL, monadTestnet, publicClient } from "./chain";

/** The relayer pays gas for every signed request; the faucet hands out test AUSD. Keys live only in env vars. */
export function signer(kind: "keeper" | "faucet") {
  const key = (kind === "keeper" ? process.env.KEEPER_KEY : process.env.FAUCET_KEY) as Hex | undefined;
  if (!key) throw new Error(`${kind === "keeper" ? "Relayer" : "Faucet"} is not configured on this deployment.`);
  const account = privateKeyToAccount(key);
  return createWalletClient({ account, chain: monadTestnet, transport: http(RPC_URL) });
}

type Client = ReturnType<typeof signer>;

/** Within one server instance, a signer sends one transaction at a time, so its nonces never collide. */
const queues = new Map<string, Promise<unknown>>();
function serialised<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(key, next);
  next.finally(() => queues.get(key) === next && queues.delete(key)).catch(() => {});
  return next;
}

/**
 * Sends a transaction and waits for its receipt. Monad charges for the gas limit, not gas used, and
 * prices storage differently from Ethereum, so the limit is the chain's own estimate plus 15%.
 * Sends from one signer are serialised per instance; a nonce race with another instance is retried
 * with a fresh nonce and a little jitter.
 */
export function sendAndWait(client: Client, tx: { to: Address; data: Hex; minGas?: bigint }) {
  return serialised(client.account.address, async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const est = await publicClient.estimateGas({ account: client.account.address, to: tx.to, data: tx.data });
        const gas = (est * 115n) / 100n > (tx.minGas ?? 0n) ? (est * 115n) / 100n : tx.minGas!;
        const nonce = await publicClient.getTransactionCount({ address: client.account.address, blockTag: "pending" });
        const hash = await client.sendTransaction({ to: tx.to, data: tx.data, gas, nonce, account: client.account, chain: monadTestnet });
        const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 150, timeout: 30_000 });
        if (receipt.status !== "success") throw new Error("Monad rejected the transaction.");
        return { hash, block: Number(receipt.blockNumber), logs: receipt.logs };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (attempt < 3 && /nonce|replacement|already known/i.test(msg)) {
          await new Promise((r) => setTimeout(r, 150 + Math.random() * 400));
          continue;
        }
        throw e;
      }
    }
  });
}

/** Pulls Till's custom error name out of a failed simulation so the app can explain it. */
export function revertReason(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((err) => err instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (revert?.data?.errorName) return revert.data.errorName;
    const raw = e.walk((err) => typeof (err as { data?: unknown }).data === "string") as { data?: Hex } | null;
    if (raw?.data) {
      try {
        return decodeErrorResult({ abi: tillAbi, data: raw.data }).errorName;
      } catch {}
    }
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Very small in-memory limiter per serverless instance; enough to stop a runaway loop on testnet. */
const hits = new Map<string, number[]>();
let lastPrune = 0;
export function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (now - lastPrune > 60_000) {
    // Forget keys that have gone quiet, so a stream of fresh signers can't grow the map without end.
    lastPrune = now;
    for (const [k, list] of hits) if (now - (list.at(-1) ?? 0) > 3_600_000) hits.delete(k);
  }
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return true;
  }
  list.push(now);
  hits.set(key, list);
  return false;
}

/** The caller's address as the platform saw it (Vercel sets x-real-ip; the first forwarded hop is the fallback). */
export const clientIp = (req: Request) => req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "?";

/** The smallest tab budget or top-up the relayer will pay gas for: half a test dollar. */
export const MIN_BUDGET = 500_000n;

/**
 * How much test MON the relayer keeps back before it pays for each kind of action, so that when gas
 * runs low the actions that return money (clock-outs, closes, cash-outs) keep working longest.
 * Watch-payouts stop first, then new tabs and transfers, then clock-ins; closes run to the last drop.
 */
export const RESERVE = {
  settle: 400_000_000_000_000_000n, // 0.4 MON: watch-payouts pause
  open: 150_000_000_000_000_000n, // 0.15 MON: new tabs, top-ups, sends and profiles pause
  clockIn: 50_000_000_000_000_000n, // 0.05 MON: clock-ins pause
  essential: 0n, // clock-outs, holds, closes and invite claims run while anything is left
} as const;

/** Which reserve a forwarded Till call must clear. */
export function reserveFor(fn: string): keyof typeof RESERVE {
  if (fn === "settle") return "settle";
  if (fn === "clockIn") return "clockIn";
  if (fn === "clockOut" || fn === "hold" || fn === "close" || fn === "claim") return "essential";
  return "open";
}

const LOW_GAS =
  "The relayer is low on test MON, so this action is paused for the moment. Clock-outs and closes still work, and nothing you have earned is lost.";

/** Refuses an action when the relayer's MON is below the tier it needs; returns the message to show. */
export async function lowOnGas(tier: keyof typeof RESERVE): Promise<string | null> {
  if (RESERVE[tier] === 0n) return null;
  const mon = await publicClient.getBalance({ address: signer("keeper").account.address }).catch(() => null);
  if (mon === null) return null; // an RPC hiccup must not block the action; the send itself will fail loudly
  return mon < RESERVE[tier] ? LOW_GAS : null;
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export { TILL };
