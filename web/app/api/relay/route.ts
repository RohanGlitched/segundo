import { concat, decodeFunctionData, encodeFunctionData, isAddress, keccak256, type Address, type Hex } from "viem";
import { forwarderAbi, tillAbi } from "@/lib/abi";
import { authorizationCall, authorizationKey, type SignedAuthorization } from "@/lib/authorization";
import { DOLLAR, FORWARDER, TILL, TREASURY, dollarAbi, publicClient } from "@/lib/chain";
import { feeFor, formatFee } from "@/lib/money";
import { feeRefundNonce, fromTreasury, refundClosedTab, requestRan, type Refund, type TabRefund } from "@/lib/refund";
import type { Relayer } from "@/lib/pool";
import { LOW_GAS, MIN_BUDGET, asRelayer, clientIp, json, limited, noOp, relayerFor, reserveFor, revertReason, sendAndWait } from "@/lib/server";

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
  let body: { request?: Req; fee?: SignedAuthorization; refund?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send a signed request." }, 400);
  }
  if (body.refund !== undefined) return retryRefund(req, body.refund);
  const r = body.request;
  if (!r || typeof r.data !== "string" || typeof r.signature !== "string" || !isAddress(r.from)) return json({ error: "Send a signed request." }, 400);
  let gas: bigint;
  let claimed: bigint;
  try {
    if (r.to?.toLowerCase() !== TILL.toLowerCase() || BigInt(r.value) !== 0n) return json({ error: "The relayer only pays for Segundo actions." }, 400);
    gas = BigInt(r.gas);
    claimed = BigInt(r.nonce);
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
  let fee: { value: bigint; data: Hex; key: string; nonce: Hex } | null = null;
  if (amount > 0n) {
    const f = body.fee;
    if (!f) return json({ error: "This page is out of date: Segundo now adds a 1% fee to budgets and top-ups. Reload the page and try again." }, 400);
    try {
      const call = authorizationCall(f);
      if (f.from.toLowerCase() !== r.from.toLowerCase() || f.to.toLowerCase() !== TREASURY.toLowerCase()) throw new Error("parties");
      if (call.value < owed) return json({ error: `Segundo's 1% fee on this is ${formatFee(owed)}. Reload the page and try again.` }, 400);
      if (call.validBefore < BigInt(Math.floor(Date.now() / 1000)) + FEE_MIN_LIFE) return json({ error: "The fee signature has expired. Try again." }, 400);
      fee = { value: call.value, data: call.data, key: `fee:${authorizationKey(f)}`, nonce: f.nonce };
    } catch {
      return json({ error: "The fee isn't signed properly. Reload the page and try again." }, 400);
    }
  }

  const from = r.from.toLowerCase();
  const ip = clientIp(req);
  // Calls on a tab are paced per tab as well, so a loop of free holds or clock-ins on one tab stops quickly.
  const tab = fn === "open" || fn === "openWithPermit" || fn === "setProfile" ? null : String(args[0]);
  if (
    limited(`relay:${from}`, 40, 60_000) ||
    limited(`relay-ip:${ip}`, 60, 60_000) ||
    limited("relay:all", 240, 60_000) ||
    (tab !== null && limited(`relay-tab:${tab}`, 12, 60_000)) ||
    (fn === "setProfile" && limited(`relay-profile-ip:${ip}`, 6, 60_000))
  )
    return json({ error: "Too many actions in a minute. Wait a moment and try again." }, 429);
  if (limited(`relay-hour:${from}`, 300, 3_600_000) || limited(`relay-hour-ip:${ip}`, 600, 3_600_000))
    return json({ error: "Too many actions this hour. Try again later." }, 429);
  // The signer's own relayer key: their actions stay in order on it while other people's run on the rest of the pool.
  // When gas runs low, the actions that give money back keep working longest.
  const { relayer: keeper, low } = await relayerFor(r.from, reserveFor(fn));
  if (low) return json({ error: low, lowGas: true }, 503);

  const request = { from: r.from, to: r.to, value: 0n, gas, deadline: Number(r.deadline), data: r.data, signature: r.signature };
  // The forwarder signs requests under the signer's current nonce. Read before verify, it is the nonce this request
  // was signed for, which is what tells later whether the request ran somewhere else.
  const nonce = (await publicClient.readContract({ address: FORWARDER, abi: forwarderAbi, functionName: "nonces", args: [r.from] }).catch(() => null)) as bigint | null;
  const valid =
    nonce !== null &&
    nonce === claimed &&
    (await publicClient.readContract({ address: FORWARDER, abi: forwarderAbi, functionName: "verify", args: [request] }).catch(() => false));
  if (!valid || nonce === null) return json({ error: "The signature doesn't match this request. Reload the page and try again." }, 400);
  // Valid on chain but changing nothing: the relayer would only burn gas on it.
  const nothing = await noOp(fn, args, r.from);
  if (nothing) return json({ error: nothing }, 409);

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
    // The fee goes first. Sent after the tab, the money for it could be moved away in between (another send, or a
    // second open in another server instance) and the tab would stand unpaid for. A fee authorisation is
    // single-use on chain, so it can pay for one open or top-up only.
    let feePaid: { value: bigint; hash: Hex; block: number; ms: number } | null = null;
    if (fee) {
      const started = Date.now();
      try {
        const { logs: _logs, ...paid } = await sendAndWait(keeper, { to: DOLLAR, data: fee.data });
        feePaid = { value: fee.value, ...paid, ms: Date.now() - started };
      } catch (e) {
        const why = revertReason(e);
        if (why === LOW_GAS) return json({ error: why, lowGas: true }, 503);
        console.warn(`fee not collected for ${fn} by ${r.from}: ${why}`);
        return json({ error: "The fee didn't go through, so nothing was sent. Reload the page and try again." }, 400);
      }
    }

    const data = encodeFunctionData({ abi: forwarderAbi, functionName: "execute", args: [request] });
    let landed: { hash: Hex; block: number };
    try {
      // Checked again now that the fee has moved: the tab or the wallet may have changed meanwhile.
      if (feePaid) await publicClient.estimateGas({ account: FORWARDER, to: TILL, data: concat([r.data, r.from]) });
      const { logs: _logs, ...sent } = await sendAndWait(keeper, { to: FORWARDER, data, minGas: gas + OVERHEAD });
      landed = sent;
    } catch (e) {
      const why = revertReason(e);
      if (!feePaid || !fee) return json({ error: why }, 502);
      // The fee goes back only for a request that didn't run. A copy of the signed request sent straight to the
      // forwarder makes this send fail too, and that tab was funded: its fee stays.
      const ran = await requestRan(r.from, nonce, r.data).catch(() => requestRan(r.from, nonce, r.data)).catch(() => null);
      if (ran !== false) {
        console.error(`!!! ${fn} by ${r.from} failed after its ${fee.value} fee landed in ${feePaid.hash} (${why}); request nonce ${nonce} ${ran ? "ran elsewhere" : "unknown"}, fee kept`);
        const error = ran
          ? "That action has already gone through (it was sent another way as well), so Segundo's fee stays with it. Reload to see it."
          : "The action didn't go through and Segundo couldn't confirm it hasn't run elsewhere, so the fee is held for now. Reload to see where it stands.";
        return json({ error, reason: why, fee: fee.value, feeHash: feePaid.hash }, ran ? 409 : 502);
      }
      // The fee paid for something that didn't happen: it goes straight back.
      console.error(`!!! ${fn} by ${r.from} failed after its ${fee.value} fee landed in ${feePaid.hash} (${why}); refunding the fee`);
      const back = await refundFee(keeper, r.from, fee.value, fee.nonce);
      const error = back.feeRefund
        ? `The ${fn.startsWith("open") ? "tab couldn't be opened" : "top-up didn't go through"} (your wallet or the tab changed meanwhile), so Segundo's fee has been sent back. Nothing else moved.`
        : `The ${fn.startsWith("open") ? "tab couldn't be opened" : "top-up didn't go through"}. ${back.feeRefundError}`;
      return json({ error, reason: why, fee: fee.value, feeHash: feePaid.hash, ...back }, 502);
    }

    const result: Record<string, unknown> = { ...landed, fn };
    if (feePaid) Object.assign(result, { fee: feePaid.value, feeHash: feePaid.hash, feeBlock: feePaid.block, feeMs: feePaid.ms });
    if (fn === "close") {
      // Clients pay only for time worked: 1% of the unspent budget comes back from the treasury.
      const started = Date.now();
      const id = args[0] as bigint;
      try {
        const back: TabRefund = await asRelayer(keeper, () => refundClosedTab(id, true));
        result.feeRefund = back.hash ? { value: back.value, hash: back.hash, block: back.block } : { value: 0n, note: back.note };
      } catch (e) {
        console.error(`!!! FEE REFUND FAILED for closed tab ${id} (close ${landed.hash}): ${revertReason(e)}`);
        result.feeRefundError = "The tab is closed and the unspent budget is back in the client's wallet, but Segundo's fee refund didn't go through yet.";
      }
      // The refund's wait isn't part of the close's own time on the receipt.
      result.feeMs = Date.now() - started;
    }
    return json(result);
  } finally {
    inFlight.delete(key);
    if (fee) inFlight.delete(fee.key);
  }
}

/** Sends a whole fee back to the client, submitted by the request's own relayer key; never throws, since the caller is already answering with an error. */
async function refundFee(keeper: Relayer, to: Address, value: bigint, clientNonce: Hex): Promise<{ feeRefund?: Refund; feeRefundError?: string }> {
  try {
    return { feeRefund: await asRelayer(keeper, () => fromTreasury(to, value, feeRefundNonce(clientNonce))) };
  } catch (e) {
    console.error(`!!! FEE REFUND FAILED: ${value} to ${to} for fee nonce ${clientNonce}: ${revertReason(e)}`);
    return { feeRefundError: "Segundo's fee was taken but its refund didn't go through yet. It will be sent back." };
  }
}

/** POST { refund: "<tab id>" } sends a closed tab's fee refund if it didn't go at close. Safe to repeat: AUSD refuses a second one. */
async function retryRefund(req: Request, raw: unknown) {
  if (typeof raw !== "string" || !/^\d{1,12}$/.test(raw)) return json({ error: "Which tab?" }, 400);
  if (limited(`refund:${raw}`, 2, 60_000) || limited(`refund-ip:${clientIp(req)}`, 10, 60_000)) return json({ error: "Try again in a minute." }, 429);
  const { relayer, low } = await relayerFor(BigInt(raw), "essential");
  if (low) return json({ error: low, lowGas: true }, 503);
  const key = `refund:${raw}`;
  if (inFlight.has(key)) return json({ error: "That refund is already on its way." }, 409);
  inFlight.add(key);
  try {
    const back = await asRelayer(relayer, () => refundClosedTab(BigInt(raw)));
    return json({ feeRefund: back.hash ? { value: back.value, hash: back.hash, block: back.block } : { value: 0n, note: back.note } });
  } catch (e) {
    return json({ feeRefundError: revertReason(e) }, 400);
  } finally {
    inFlight.delete(key);
  }
}
