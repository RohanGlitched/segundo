import { concat, decodeFunctionData, encodeFunctionData, isAddress, keccak256, type Address, type Hex } from "viem";
import { forwarderAbi, tillAbi } from "@/lib/abi";
import { FORWARDER, TILL, publicClient } from "@/lib/chain";
import { MIN_BUDGET, clientIp, json, limited, lowOnGas, reserveFor, revertReason, sendAndWait, signer } from "@/lib/server";

export const runtime = "nodejs";

/** Till calls the relayer will pay for. Views and anything else are refused. */
const ALLOWED = new Set([
  "open",
  "openWithPermit",
  "claim",
  "clockIn",
  "clockOut",
  "hold",
  "setRate",
  "topUp",
  "topUpWithPermit",
  "settle",
  "close",
  "setProfile",
]);
const MAX_CALL_GAS = 900_000n;
/** Forwarder overhead: signature check, nonce, and the 1/64 gas reserve it keeps for itself. */
const OVERHEAD = 70_000n;
/** Requests being sent right now, keyed by their signature, so two copies of one request can't both cost gas. */
const inFlight = new Set<string>();

type Req = { from: Address; to: Address; value: string; gas: string; nonce: string; deadline: number; data: Hex; signature: Hex };

export async function POST(req: Request) {
  let body: { request?: Req };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send a signed request." }, 400);
  }
  const r = body.request;
  if (!r || typeof r.data !== "string" || typeof r.signature !== "string" || !isAddress(r.from)) return json({ error: "Send a signed request." }, 400);
  let gas: bigint;
  try {
    if (r.to?.toLowerCase() !== TILL.toLowerCase() || BigInt(r.value) !== 0n) return json({ error: "The relayer only pays for Till actions." }, 400);
    gas = BigInt(r.gas);
    BigInt(r.nonce); // must parse; the forwarder checks the real one
  } catch {
    return json({ error: "Send a signed request." }, 400);
  }
  if (gas > MAX_CALL_GAS) return json({ error: "That request asks for too much gas." }, 400);

  let fn: string;
  let args: readonly unknown[];
  try {
    const d = decodeFunctionData({ abi: tillAbi, data: r.data });
    fn = d.functionName;
    args = d.args ?? [];
  } catch {
    return json({ error: "The relayer only pays for Till actions." }, 400);
  }
  if (!ALLOWED.has(fn)) return json({ error: "The relayer only pays for Till actions." }, 400);
  // Gas is the scarce thing on testnet: no dust tabs, and a pace per signer, per address and overall.
  if ((fn === "open" || fn === "openWithPermit") && (args[3] as bigint) < MIN_BUDGET) return json({ error: "The smallest tab the relayer pays for is $0.50." }, 400);
  if ((fn === "topUp" || fn === "topUpWithPermit") && (args[1] as bigint) < MIN_BUDGET) return json({ error: "The smallest top-up the relayer pays for is $0.50." }, 400);
  const from = r.from.toLowerCase();
  if (limited(`relay:${from}`, 40, 60_000) || limited(`relay-ip:${clientIp(req)}`, 60, 60_000) || limited("relay:all", 240, 60_000))
    return json({ error: "Too many actions in a minute. Wait a moment and try again." }, 429);
  // When gas runs low, the actions that give money back keep working longest.
  const low = await lowOnGas(reserveFor(fn));
  if (low) return json({ error: low, lowGas: true }, 503);

  const request = { from: r.from, to: r.to, value: 0n, gas, deadline: Number(r.deadline), data: r.data, signature: r.signature };
  const valid = await publicClient
    .readContract({ address: FORWARDER, abi: forwarderAbi, functionName: "verify", args: [request] })
    .catch(() => false);
  if (!valid) return json({ error: "The signature doesn't match this request. Reload the page and try again." }, 400);

  // Estimate the inner call exactly as the forwarder will make it: a revert comes back with its reason,
  // and the gas the signer asked for must be close to what the call needs (Monad charges the limit).
  let inner: bigint;
  try {
    inner = await publicClient.estimateGas({ account: FORWARDER, to: TILL, data: concat([r.data, r.from]) });
  } catch (e) {
    return json({ error: revertReason(e) }, 400);
  }
  if (gas > (inner * 3n) / 2n + 20_000n) return json({ error: "That request asks for too much gas. Reload the page and try again." }, 400);

  // The nonce in the body is only the signer's claim; the signature is what identifies the request.
  const key = keccak256(r.signature);
  if (inFlight.has(key)) return json({ error: "That action is already on its way." }, 409);
  inFlight.add(key);
  try {
    const keeper = signer("keeper");
    const data = encodeFunctionData({ abi: forwarderAbi, functionName: "execute", args: [request] });
    const { logs: _logs, ...landed } = await sendAndWait(keeper, { to: FORWARDER, data, minGas: gas + OVERHEAD });
    return json({ ...landed, fn });
  } catch (e) {
    return json({ error: revertReason(e) }, 502);
  } finally {
    inFlight.delete(key);
  }
}
