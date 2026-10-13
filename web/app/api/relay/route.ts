import { concat, decodeFunctionData, encodeFunctionData, isAddress, keccak256, type Address, type Hex } from "viem";
import { forwarderAbi, tillAbi } from "@/lib/abi";
import { authorizationCall, authorizationKey, type SignedAuthorization } from "@/lib/authorization";
import { DOLLAR, FORWARDER, TILL, TREASURY, dollarAbi, publicClient } from "@/lib/chain";
import { feeFor, formatFee } from "@/lib/money";
import { LOW_GAS, MIN_BUDGET, clientIp, json, limited, lowOnGas, reserveFor, revertReason, sendAndWait, signer } from "@/lib/server";

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
/** Calls that move a client's money into a tab carry Segundo's 1% fee; the value says which argument is the amount. */
const FEE_ARG: Record<string, number> = { open: 3, openWithPermit: 3, topUp: 1, topUpWithPermit: 1 };
const MAX_CALL_GAS = 900_000n;
/** Forwarder overhead: signature check, nonce, and the 1/64 gas reserve it keeps for itself. */
const OVERHEAD = 70_000n;
/** A fee authorisation must stay valid at least this long, so it can't expire between the open and its own send. */
const FEE_MIN_LIFE = 120n;
/** Requests (and fee authorisations) being sent right now, so two copies of one can't both cost gas. */
const inFlight = new Set<string>();

type Req = { from: Address; to: Address; value: string; gas: string; nonce: string; deadline: number; data: Hex; signature: Hex };

export async function POST(req: Request) {
  let body: { request?: Req; fee?: SignedAuthorization };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send a signed request." }, 400);
  }
  const r = body.request;
  if (!r || typeof r.data !== "string" || typeof r.signature !== "string" || !isAddress(r.from)) return json({ error: "Send a signed request." }, 400);
  let gas: bigint;
  try {
    if (r.to?.toLowerCase() !== TILL.toLowerCase() || BigInt(r.value) !== 0n) return json({ error: "The relayer only pays for Segundo actions." }, 400);
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
    return json({ error: "The relayer only pays for Segundo actions." }, 400);
  }
  if (!ALLOWED.has(fn)) return json({ error: "The relayer only pays for Segundo actions." }, 400);
  // Gas is the scarce thing on testnet: no dust tabs, and a pace per signer, per address and overall.
  if ((fn === "open" || fn === "openWithPermit") && (args[3] as bigint) < MIN_BUDGET) return json({ error: "The smallest tab the relayer pays for is $0.50." }, 400);
  if ((fn === "topUp" || fn === "topUpWithPermit") && (args[1] as bigint) < MIN_BUDGET) return json({ error: "The smallest top-up the relayer pays for is $0.50." }, 400);

  // Money going into a tab carries the client's 1% fee, signed as an AUSD transfer to the treasury.
  const amount = fn in FEE_ARG ? (args[FEE_ARG[fn]!] as bigint) : 0n;
  const owed = feeFor(amount);
  let fee: { value: bigint; data: Hex; key: string } | null = null;
  if (amount > 0n) {
    const f = body.fee;
    if (!f) return json({ error: "This page is out of date: Segundo now adds a 1% fee to budgets and top-ups. Reload the page and try again." }, 400);
    try {
      const call = authorizationCall(f);
      if (f.from.toLowerCase() !== r.from.toLowerCase() || f.to.toLowerCase() !== TREASURY.toLowerCase()) throw new Error("parties");
      if (call.value < owed) return json({ error: `Segundo's 1% fee on this is ${formatFee(owed)}. Reload the page and try again.` }, 400);
      if (call.validBefore < BigInt(Math.floor(Date.now() / 1000)) + FEE_MIN_LIFE) return json({ error: "The fee signature has expired. Try again." }, 400);
      fee = { value: call.value, data: call.data, key: `fee:${authorizationKey(f)}` };
    } catch {
      return json({ error: "The fee isn't signed properly. Reload the page and try again." }, 400);
    }
  }

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

  const keeper = signer("keeper");
  if (fee) {
    // The budget and the fee leave the wallet together, so both must be there before anything moves.
    const balance = await publicClient.readContract({ address: DOLLAR, abi: dollarAbi, functionName: "balanceOf", args: [r.from] }).catch(() => null);
    if (balance != null && balance < amount + fee.value)
      return json(
        { error: `That needs ${formatFee(amount + fee.value)} in your wallet: ${formatFee(amount)} for the ${fn.startsWith("open") ? "budget" : "top-up"} plus Segundo's 1% fee of ${formatFee(fee.value)}. You have ${formatFee(balance)}.` },
        400,
      );
    // Run the fee transfer as the keeper will send it, so a bad or spent signature is refused before the tab moves.
    try {
      await publicClient.estimateGas({ account: keeper.account.address, to: DOLLAR, data: fee.data });
    } catch (e) {
      const why = revertReason(e);
      if (/balance/i.test(why)) return json({ error: "Not enough AUSD in your wallet for the budget plus the 1% fee." }, 400);
      if (why === LOW_GAS) return json({ error: why, lowGas: true }, 503);
      console.warn(`fee refused for ${r.from}: ${why}`);
      return json({ error: "The fee signature wasn't accepted, so nothing was sent. Reload the page and try again." }, 400);
    }
  }

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
  if (inFlight.has(key) || (fee && inFlight.has(fee.key))) return json({ error: "That action is already on its way." }, 409);
  inFlight.add(key);
  if (fee) inFlight.add(fee.key);
  try {
    const data = encodeFunctionData({ abi: forwarderAbi, functionName: "execute", args: [request] });
    let landed: { hash: Hex; block: number };
    try {
      const { logs: _logs, ...sent } = await sendAndWait(keeper, { to: FORWARDER, data, minGas: gas + OVERHEAD });
      landed = sent;
    } catch (e) {
      return json({ error: revertReason(e) }, 502);
    }
    if (!fee) return json({ ...landed, fn });

    // The tab is funded; now collect the fee. If that fails the tab still stands, so say so rather than fail.
    const started = Date.now();
    try {
      const { logs: _logs, ...paid } = await sendAndWait(keeper, { to: DOLLAR, data: fee.data });
      return json({ ...landed, fn, fee: fee.value, feeHash: paid.hash, feeBlock: paid.block, feeMs: Date.now() - started });
    } catch (e) {
      const why = revertReason(e);
      console.error(`!!! FEE NOT COLLECTED: ${fn} by ${r.from} landed in ${landed.hash}, but the ${fee.value} fee transfer failed: ${why}`);
      return json({ ...landed, fn, fee: fee.value, feeError: "The tab is funded, but Segundo's fee didn't go through. Nothing more is needed from you.", feeMs: Date.now() - started });
    }
  } finally {
    inFlight.delete(key);
    if (fee) inFlight.delete(fee.key);
  }
}
