"use client";

import { concat, encodeFunctionData, hexToSignature, toHex, type Address, type Hex } from "viem";
import { tillAbi, forwarderAbi } from "./abi";
import { FORWARDER, TILL, DOLLAR, DOLLAR_DOMAIN, TREASURY, monadTestnet, publicClient, dollarAbi } from "./chain";
import { feeFor } from "./money";
import type { Wallet } from "./wallet";

export type Landed = { hash: Hex; block: number; ms: number; fee?: FeePaid };
/** Segundo's 1% fee as it went: its own transaction, or why it didn't go (the tab is funded either way). */
export type FeePaid = { value: bigint; hash?: Hex; block?: number; error?: string };
/** A signed AUSD transfer of the fee to the treasury, sent alongside the forwarded open or top-up. */
export type SignedFee = { from: Address; to: Address; value: bigint; validBefore: bigint; nonce: Hex; signature: Hex };

/**
 * Fallback gas for each forwarded call if estimation fails. Normally the call is estimated on Monad
 * first (Monad charges for the gas limit and prices storage its own way) and given 25% headroom.
 */
const CALL_GAS: Record<string, bigint> = {
  open: 330_000n,
  openWithPermit: 380_000n,
  claim: 170_000n,
  clockIn: 90_000n,
  clockOut: 90_000n,
  hold: 100_000n,
  setRate: 70_000n,
  topUp: 150_000n,
  topUpWithPermit: 200_000n,
  settle: 110_000n,
  close: 190_000n,
  setProfile: 200_000n,
};

const forwardTypes = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
} as const;

const transferTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)) });
  const json = await res.json().catch(() => ({ error: "The server sent an unreadable reply. Try again." }));
  if (!res.ok) throw new Error(json.error || "Something went wrong. Try again.");
  return json as T;
}

/**
 * A passkey account whose signing session has locked must be unlocked before any network work: Safari only
 * shows a passkey prompt shortly after the tap that started the action.
 */
async function ready(wallet: Wallet) {
  if (wallet.kind === "mera" && !wallet.unlocked) await wallet.unlock?.();
}

/**
 * Signs a Till call as the user and has the relayer submit it through the forwarder. Opens and
 * top-ups carry a signed fee (see signFee), which the relayer collects once the call has landed.
 */
export async function relay(wallet: Wallet, fn: string, args: readonly unknown[], fee?: SignedFee): Promise<Landed> {
  await ready(wallet);
  const from = wallet.address;
  if (!from) throw new Error("Sign in first.");
  const data = encodeFunctionData({ abi: tillAbi, functionName: fn as never, args: args as never });
  const nonce = (await publicClient.readContract({ address: FORWARDER, abi: forwarderAbi, functionName: "nonces", args: [from] })) as bigint;
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const est = await publicClient
    .estimateGas({ account: FORWARDER, to: TILL, data: concat([data, from]) })
    .catch(() => null);
  const gas = est ? (est * 125n) / 100n + 5_000n : (CALL_GAS[fn] ?? 200_000n);
  const message = { from, to: TILL, value: 0n, gas, nonce, deadline, data };
  const signature = await wallet.signTypedData({
    domain: { name: "Till", version: "1", chainId: monadTestnet.id, verifyingContract: FORWARDER },
    types: forwardTypes,
    primaryType: "ForwardRequest",
    message,
  });
  const started = performance.now();
  const res = await post<{ hash: Hex; block: number; fee?: string; feeHash?: Hex; feeBlock?: number; feeError?: string; feeMs?: number }>(
    "/api/relay",
    fee ? { request: { ...message, signature }, fee } : { request: { ...message, signature } },
  );
  // The relayer waits for the fee after the call itself lands; that wait isn't part of the call's own time.
  const ms = Math.max(0, Math.round(performance.now() - started - (res.feeMs ?? 0)));
  const paid: FeePaid | undefined =
    res.fee != null ? { value: BigInt(res.fee), hash: res.feeHash, block: res.feeBlock, error: res.feeError } : undefined;
  return { hash: res.hash, block: res.block, ms, ...(paid ? { fee: paid } : {}) };
}

/** Segundo's 1% fee on a budget or top-up, signed as an AUSD transfer (EIP-3009) from the client to the treasury. */
export async function signFee(wallet: Wallet, amount: bigint): Promise<SignedFee> {
  await ready(wallet);
  const from = wallet.address;
  if (!from) throw new Error("Sign in first.");
  const value = feeFor(amount);
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const signature = await wallet.signTypedData({
    domain: { ...DOLLAR_DOMAIN, chainId: monadTestnet.id, verifyingContract: DOLLAR },
    types: transferTypes,
    primaryType: "TransferWithAuthorization",
    message: { from, to: TREASURY, value, validAfter: 0n, validBefore, nonce },
  });
  return { from, to: TREASURY, value, validBefore, nonce, signature };
}

/** EIP-2612 permit for AUSD so opening or topping up a tab needs no approval transaction. */
export async function signPermit(wallet: Wallet, value: bigint) {
  await ready(wallet);
  const owner = wallet.address!;
  const nonce = (await publicClient.readContract({ address: DOLLAR, abi: dollarAbi, functionName: "nonces", args: [owner] })) as bigint;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const sig = await wallet.signTypedData({
    domain: { ...DOLLAR_DOMAIN, chainId: monadTestnet.id, verifyingContract: DOLLAR },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: { owner, spender: TILL, value, nonce, deadline },
  });
  const { r, s, v } = hexToSignature(sig);
  return { deadline, v: Number(v ?? 27n), r, s };
}

/** Sends AUSD out of the user's wallet with an EIP-3009 authorization the relayer submits. */
export async function sendDollars(wallet: Wallet, to: Address, value: bigint): Promise<Landed> {
  await ready(wallet);
  const from = wallet.address!;
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const sig = await wallet.signTypedData({
    domain: { ...DOLLAR_DOMAIN, chainId: monadTestnet.id, verifyingContract: DOLLAR },
    types: transferTypes,
    primaryType: "TransferWithAuthorization",
    message: { from, to, value, validAfter: 0n, validBefore, nonce },
  });
  const started = performance.now();
  const res = await post<{ hash: Hex; block: number }>("/api/send", { from, to, value, validBefore, nonce, signature: sig });
  return { ...res, ms: Math.round(performance.now() - started) };
}

export async function requestTestDollars(address: Address): Promise<Landed> {
  const started = performance.now();
  const res = await post<{ hash: Hex; block: number }>("/api/faucet", { address });
  return { ...res, ms: Math.round(performance.now() - started) };
}

/** Anyone may settle a tab: used by the tab page to pay out while someone is watching. */
export async function settleNow(id: bigint): Promise<Landed & { amount: bigint }> {
  const started = performance.now();
  const res = await post<{ hash?: Hex; block?: number; amount?: string; skipped?: boolean; reason?: string }>("/api/settle", { id: id.toString() });
  if (!res.hash) throw new Error(res.reason ?? "Nothing to pay out right now.");
  return { hash: res.hash, block: res.block!, amount: BigInt(res.amount ?? "0"), ms: Math.round(performance.now() - started) };
}

/** Turns contract and relayer errors into one plain sentence. */
export function plainError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const known: [RegExp, string][] = [
    [/User rejected|denied|rejected the request/i, "The signature was cancelled. Nothing was sent."],
    [/OnHold/, "The client has paused pay on this tab. You can clock in when they resume it."],
    [/BudgetUsed/, "This tab's budget is used up. The client can top it up."],
    [/AlreadyIn/, "The clock is already running."],
    [/NotIn/, "The clock isn't running."],
    [/BadInvite/, "This invite link isn't valid for your account. Ask the client for a new one."],
    [/AlreadyClaimed/, "Someone has already joined this tab with this invite."],
    [/SelfPay/, "You can't pay yourself. Open the invite in the freelancer's browser."],
    [/TabClosed/, "This tab is closed."],
    [/NotPayer/, "Only the client who opened this tab can do that."],
    [/NotPayee/, "Only the freelancer on this tab can clock in."],
    [/NotParty/, "Only the client or the freelancer on this tab can do that."],
    [/transfer amount exceeds balance|exceeds balance/i, "Not enough AUSD in your wallet. Get test AUSD first."],
    [/timed out|timeout/i, "Monad hasn't confirmed that yet. Give the pay stub a moment, then try again if nothing changed."],
    [/already on its way/i, "That action is already on its way. Give it a moment."],
    [/fetch failed|NetworkError|Failed to fetch/i, "Couldn't reach Segundo's server. Check your connection and try again."],
  ];
  for (const [re, words] of known) if (re.test(msg)) return words;
  return msg.length < 160 ? msg : "Monad didn't accept that. Try again in a moment.";
}
