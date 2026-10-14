import { formatEther, parseEther } from "viem";
import { DOLLAR, dollarAbi, publicClient } from "@/lib/chain";
import { pool } from "@/lib/pool";
import { REFUND_WALLET_CAP, refundWallet } from "@/lib/privy-server";
import { RESERVE, json, signer } from "@/lib/server";

/** With AUTO_REFUEL=1 set on the deployment, a health check that finds a relayer key under its top reserve moves this much test MON from the faucet wallet to the poorest key, at most once every ten minutes per instance. Off by default. */
const REFUEL = parseEther("3");
const REFUEL_KEEP = parseEther("2");
let lastRefuel = 0;

export const runtime = "nodejs";

/** Segundo's Privy refund wallet (lib/privy-server.ts): its address and float, or null when this deployment has none. */
async function refundFloat() {
  try {
    const w = await refundWallet();
    if (!w) return null;
    const [mon, ausd] = await Promise.all([
      publicClient.getBalance({ address: w.address }),
      publicClient.readContract({ address: DOLLAR, abi: dollarAbi, functionName: "balanceOf", args: [w.address] }) as Promise<bigint>,
    ]);
    return { provider: "privy-server-wallet", address: w.address, ausd: (Number(ausd) / 1e6).toFixed(2), mon: formatEther(mon), maxRefundAusd: (Number(REFUND_WALLET_CAP) / 1e6).toFixed(2) };
  } catch (e) {
    return { provider: "privy-server-wallet", error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * How the gasless path is doing, for the app's notice bar and for anyone checking before a demo:
 * the relayer pool's test MON against the reserve tiers, the faucet wallet's MON and AUSD, and chain lag.
 * A request goes to its own pool key and moves to the richest one when its key is short, so an action is
 * paused only when no key in the pool can pay for it. Only public addresses and balances; nothing here is a secret.
 */
export async function GET() {
  try {
    const keys = pool().map((k) => k.account.address);
    const keeper = keys[0]!;
    const faucet = signer("faucet").account.address;
    const [poolMon, faucetMon, faucetAusd, block, refunds] = await Promise.all([
      Promise.all(keys.map((address) => publicClient.getBalance({ address }))),
      publicClient.getBalance({ address: faucet }),
      publicClient.readContract({ address: DOLLAR, abi: dollarAbi, functionName: "balanceOf", args: [faucet] }) as Promise<bigint>,
      publicClient.getBlock(),
      refundFloat(),
    ]);
    const keeperMon = poolMon[0]!;
    const most = poolMon.reduce((a, b) => (b > a ? b : a));
    const least = poolMon.reduce((a, b) => (b < a ? b : a));
    const poorest = poolMon.indexOf(least);
    const paused = (Object.keys(RESERVE) as (keyof typeof RESERVE)[]).filter((k) => most < RESERVE[k]);
    // ok: nothing paused · payouts: only watch-payouts · low: new tabs and sends too · out: clock-ins too · empty: everything
    const status = paused.length === 0 ? "ok" : paused.includes("essential") ? "empty" : paused.includes("clockIn") ? "out" : paused.includes("open") ? "low" : "payouts";
    let refuel: string | null = null;
    if (process.env.AUTO_REFUEL === "1" && least < RESERVE.settle && faucetMon > REFUEL + REFUEL_KEEP && Date.now() - lastRefuel > 600_000) {
      lastRefuel = Date.now();
      try {
        refuel = await signer("faucet").sendTransaction({ to: keys[poorest]!, value: REFUEL, gas: 21_000n });
      } catch {
        refuel = null;
      }
    }
    return json(
      {
        status,
        paused, // which kinds of action the relayer is holding back right now
        refuel, // the hash of a top-up this check just sent, when AUTO_REFUEL is on
        relayer: { address: keeper, mon: formatEther(keeperMon) }, // key 0 of the pool
        // Every relayer key: a person's actions go to hash(address) mod size, a tab's payouts to id mod size.
        pool: {
          size: keys.length,
          lowestMon: formatEther(least),
          lowest: keys[poorest],
          totalMon: formatEther(poolMon.reduce((a, b) => a + b, 0n)),
          keys: keys.map((address, i) => ({ address, mon: formatEther(poolMon[i]!) })),
        },
        faucet: { address: faucet, mon: formatEther(faucetMon), ausd: (Number(faucetAusd) / 1e6).toFixed(2) },
        // Fee refunds are signed by this Privy server wallet (policy: AUSD on Monad testnet only, at most 50 AUSD each).
        refundWallet: refunds,
        reserve: Object.fromEntries(Object.entries(RESERVE).map(([k, v]) => [k, formatEther(v)])),
        block: Number(block.number),
        blockAgeS: Math.max(0, Math.floor(Date.now() / 1000) - Number(block.timestamp)),
      },
      200,
      { "cache-control": "public, s-maxage=15, stale-while-revalidate=30" },
    );
  } catch (e) {
    return json({ status: "unknown", error: e instanceof Error ? e.message : String(e) }, 503);
  }
}
