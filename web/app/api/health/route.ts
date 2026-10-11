import { formatEther } from "viem";
import { DOLLAR, dollarAbi, publicClient } from "@/lib/chain";
import { RESERVE, json, signer } from "@/lib/server";

export const runtime = "nodejs";

/**
 * How the gasless path is doing, for the app's notice bar and for anyone checking before a demo:
 * the relayer's test MON against the reserve tiers, the faucet wallet's MON and AUSD, and chain lag.
 * Only public addresses and balances; nothing here is a secret.
 */
export async function GET() {
  try {
    const keeper = signer("keeper").account.address;
    const faucet = signer("faucet").account.address;
    const [keeperMon, faucetMon, faucetAusd, block] = await Promise.all([
      publicClient.getBalance({ address: keeper }),
      publicClient.getBalance({ address: faucet }),
      publicClient.readContract({ address: DOLLAR, abi: dollarAbi, functionName: "balanceOf", args: [faucet] }) as Promise<bigint>,
      publicClient.getBlock(),
    ]);
    const paused = (Object.keys(RESERVE) as (keyof typeof RESERVE)[]).filter((k) => RESERVE[k] > 0n && keeperMon < RESERVE[k]);
    const status = paused.length === 0 ? "ok" : paused.includes("clockIn") ? "out" : "low";
    return json(
      {
        status,
        paused, // which kinds of action the relayer is holding back right now
        relayer: { address: keeper, mon: formatEther(keeperMon) },
        faucet: { address: faucet, mon: formatEther(faucetMon), ausd: (Number(faucetAusd) / 1e6).toFixed(2) },
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
