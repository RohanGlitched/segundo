/**
 * One passkey, many keys. Every key a Segundo passkey account uses comes from the same passkey, each from its own
 * WebAuthn PRF salt (lib/mera.ts), so no key can be worked out from another:
 *
 *   family     PRF salt                       becomes                                   used for
 *   wallet     sha256("mera.prf.salt.v1")     BIP-39 → m/44'/60'/0'/0/0 secp256k1       signing pay (lib/mera.ts)
 *   seal       sha256("segundo/seal/v1")      HKDF → AES-256-GCM                        private details (lib/seal.ts)
 *   invite     sha256("segundo/invite/v1")    HKDF per tab → secp256k1 invite key       invite links (below)
 *   disclose   sha256("segundo/disclose/v1")  HKDF → X25519                             sharing with a verifier (lib/disclose.ts)
 *
 * Invite keys. Till.open(payee = 0, invite, …) stores the address of a one-time key; the invite link carries its
 * private half after the #, and Till.claim checks a signature from it. Here that key is not random but
 *
 *   inviteKey = HKDF-SHA-256(ikm  = PRF(passkey, salt = sha256("segundo/invite/v1")),
 *                            salt = "segundo/invite/v1",
 *                            info = "tab:" + chainId + ":" + till + ":" + payer + ":" + slot)   → secp256k1 scalar
 *
 * where `slot` is the position the new tab takes in Till.tabsOf(payer): tabsOf(payer).length just before the open,
 * which equals the tab's index in that list forever after (the list only grows). So the slot is known before the tab
 * exists and can be read back from the chain alone: on any device, the passkey plus tabsOf(payer) rebuild the exact
 * invite key, and the on-chain `invite` address confirms it. If something else landed in the payer's list between
 * reading it and the open (a second tab opened at the same moment), the tab sits a slot or two away; the rebuild tries
 * the neighbours and keeps only the key whose address the contract holds. Addresses are lower-case in `info`. If an
 * HKDF output isn't a valid secp256k1 scalar (odds about 2^-128), ":1", ":2", … is appended to `info`.
 *
 * Derived keys stay in page memory only, and are dropped when the passkey session locks ("segundo:lock").
 */
import { type Address, type Hex, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tillAbi } from "./abi";
import { TILL, monadTestnet, publicClient } from "./chain";
import type { Family } from "./mera";
import type { Wallet } from "./wallet";

export const SALT_LABELS: Record<Family | "wallet", string> = {
  wallet: "mera.prf.salt.v1",
  seal: "segundo/seal/v1",
  invite: "segundo/invite/v1",
  disclose: "segundo/disclose/v1",
};

const enc = new TextEncoder();
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const MERA_KEY = "segundo.passkey.v1";

type Held = { credentialId: string; invite?: CryptoKey; disclose?: Uint8Array };
let held: Held | null = null;

function forget() {
  held?.disclose?.fill(0);
  held = null;
}
if (typeof window !== "undefined") {
  window.addEventListener("segundo:lock", forget);
  window.addEventListener("pagehide", forget);
}

/** Invite keys come from a passkey: only passkey (Mera) accounts get recoverable invites. */
export function hasPasskeyKeys(wallet: Wallet): boolean {
  return wallet.kind === "mera" && !!wallet.address && !!wallet.mera;
}

/** The passkey behind the signed-in account, with the transports this browser remembers for it. */
function credentialOf(wallet: Wallet) {
  if (!hasPasskeyKeys(wallet)) throw new Error("This needs a passkey account.");
  const credentialId = wallet.mera!.credentialId;
  let transports: string[] | undefined;
  try {
    const r = JSON.parse(localStorage.getItem(MERA_KEY) || "null") as { credentialId?: string; transports?: string[] } | null;
    if (r?.credentialId === credentialId && Array.isArray(r.transports)) transports = r.transports;
  } catch {}
  return { credentialId, ...(transports ? { transports } : {}) };
}

function heldFor(credentialId: string): Held {
  if (held?.credentialId !== credentialId) {
    forget();
    held = { credentialId };
  }
  return held;
}

async function hkdfBase(prf: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey("raw", prf, "HKDF", false, ["deriveBits", "deriveKey"]);
  } finally {
    prf.fill(0);
  }
}

async function hkdfBits(base: CryptoKey, salt: string, info: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: enc.encode(salt), info: enc.encode(info) }, base, 256));
}

/** Runs a passkey ceremony and turns Mera's errors into plain words. */
async function ceremony<T>(fn: (m: typeof import("./mera")) => Promise<T>): Promise<T> {
  const m = await import("./mera");
  try {
    return await fn(m);
  } catch (e) {
    throw new Error(m.meraMessage(e));
  }
}

/* ---------------------------------------------------------------- invites */

/** The invite family's HKDF root: one fingerprint prompt, then kept until the session locks. */
async function inviteRoot(wallet: Wallet): Promise<CryptoKey> {
  const cred = credentialOf(wallet);
  const h = heldFor(cred.credentialId);
  if (h.invite) return h.invite;
  const root = await ceremony(async (m) => hkdfBase((await m.familyPrfOutputs(cred, ["invite"] as const)).invite));
  heldFor(cred.credentialId).invite = root;
  return root;
}

/** Whether invite keys can be made without another fingerprint prompt right now. */
export function inviteKeysHeld(wallet: Wallet): boolean {
  return hasPasskeyKeys(wallet) && held?.credentialId === wallet.mera!.credentialId && !!held.invite;
}

export const inviteInfo = (payer: Address, slot: number) =>
  `tab:${monadTestnet.id}:${TILL.toLowerCase()}:${payer.toLowerCase()}:${slot}`;

async function inviteKeyAt(root: CryptoKey, payer: Address, slot: number): Promise<Hex> {
  for (let counter = 0; ; counter++) {
    const info = inviteInfo(payer, slot) + (counter ? `:${counter}` : "");
    const k = await hkdfBits(root, SALT_LABELS.invite, info);
    const n = BigInt(toHex(k));
    k.fill(0);
    if (n > 0n && n < N) return toHex(n, { size: 32 });
  }
}

/** The payer's list of tabs on the contract: its length is the next slot. */
async function tabsOf(payer: Address): Promise<bigint[]> {
  return [...((await publicClient.readContract({ address: TILL, abi: tillAbi, functionName: "tabsOf", args: [payer] })) as readonly bigint[])];
}

/**
 * The invite key for the tab this account is about to open: slot = tabsOf(payer).length. Asks for the passkey once
 * per session. Returns the key and its slot.
 */
export async function nextInviteKey(wallet: Wallet): Promise<{ key: Hex; slot: number }> {
  const payer = wallet.address!;
  const [root, list] = await Promise.all([inviteRoot(wallet), tabsOf(payer)]);
  const slot = list.length;
  return { key: await inviteKeyAt(root, payer, slot), slot };
}

/**
 * Rebuilds the invite key of a tab this account opened and nobody has joined yet, from the passkey and the chain
 * alone. `invite` is the address the contract holds for the tab. Null if no nearby slot matches (the tab's invite
 * was made at random, by an email or practice account, or before invites came from passkeys).
 */
export async function rebuildInviteKey(wallet: Wallet, id: bigint, invite: Address): Promise<Hex | null> {
  const payer = wallet.address!;
  const list = await tabsOf(payer);
  const at = list.indexOf(id);
  if (at < 0) return null;
  const root = await inviteRoot(wallet);
  const tries = [0, -1, 1, -2, 2, -3, 3, -4, 4].map((d) => at + d).filter((s) => s >= 0 && s <= list.length);
  for (const slot of tries) {
    const key = await inviteKeyAt(root, payer, slot);
    if (privateKeyToAccount(key).address.toLowerCase() === invite.toLowerCase()) return key;
  }
  return null;
}

/* ---------------------------------------------------------------- disclosure */

/**
 * The disclosure family's X25519 private key: HKDF-SHA-256(PRF(salt = sha256("segundo/disclose/v1")),
 * salt = "segundo/disclose/v1", info = "x25519"), 32 bytes that X25519 clamps itself. Kept until the session locks.
 * With `withSeal`, when the key isn't held yet, the same fingerprint prompt also evaluates the sealing salt (WebAuthn's
 * second PRF input) and the sealing key is returned to the caller, so sharing details asks for the passkey once.
 */
export async function disclosureKeys(wallet: Wallet, withSeal: boolean): Promise<{ secret: Uint8Array; sealing?: CryptoKey }> {
  const cred = credentialOf(wallet);
  const h = heldFor(cred.credentialId);
  if (h.disclose) return { secret: h.disclose };
  const out = (await ceremony((m) => m.familyPrfOutputs(cred, withSeal ? (["disclose", "seal"] as const) : (["disclose"] as const)))) as Partial<
    Record<Family, Uint8Array<ArrayBuffer>>
  >;
  const secret = await hkdfBits(await hkdfBase(out.disclose!), SALT_LABELS.disclose, "x25519");
  heldFor(cred.credentialId).disclose = secret;
  const sealing = out.seal ? await (await import("./seal")).deriveSealingKey(out.seal) : undefined;
  return { secret, ...(sealing ? { sealing } : {}) };
}

/** Whether the disclosure key is in memory, so sharing needs no fingerprint prompt for it. */
export function disclosureKeyHeld(wallet: Wallet): boolean {
  return hasPasskeyKeys(wallet) && held?.credentialId === wallet.mera!.credentialId && !!held.disclose;
}
