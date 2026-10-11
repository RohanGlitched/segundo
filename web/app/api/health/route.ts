import { formatEther, parseEther } from "viem";
import { DOLLAR, dollarAbi, publicClient } from "@/lib/chain";
import { RESERVE, json, signer } from "@/lib/server";

/** With AUTO_REFUEL=1 set on the deployment, a health check that finds the relayer under its top reserve moves this much test MON from the faucet wallet to it, at most once every ten minutes per instance. Off by default. */
const REFUEL = parseEther("3");
const REFUEL_KEEP = parseEther("2");
let lastRefuel = 0;

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
    const paused = (Object.keys(RESERVE) as (keyof typeof RESERVE)[]).filter((k) => keeperMon < RESERVE[k]);
    // ok: nothing paused · payouts: only watch-payouts · low: new tabs and sends too · out: clock-ins too · empty: everything
    const status = paused.length === 0 ? "ok" : paused.includes("essential") ? "empty" : paused.includes("clockIn") ? "out" : paused.includes("open") ? "low" : "payouts";
    let refuel: string | null = null;
    if (process.env.AUTO_REFUEL === "1" && keeperMon < RESERVE.settle && faucetMon > REFUEL + REFUEL_KEEP && Date.now() - lastRefuel > 600_000) {
      lastRefuel = Date.now();
      try {
        refuel = await signer("faucet").sendTransaction({ to: keeper, value: REFUEL, gas: 21_000n });
      } catch {
        refuel = null;
      }
    }
    return json(
      {
        status,
        paused, // which kinds of action the relayer is holding back right now
        refuel, // the hash of a top-up this check just sent, when AUTO_REFUEL is on
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
