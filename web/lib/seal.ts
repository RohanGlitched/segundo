/**
 * Sealed details: a freelancer's legal name, address, tax ID and payout account, encrypted in the browser with a
 * key that only their passkey can produce. Segundo's servers never receive them, sealed or open.
 *
 * Key derivation (see lib/mera.ts for the PRF itself):
 *   prf  = passkey PRF(credential, rpId, salt = sha256("segundo/seal/v1"))   one fingerprint prompt
 *   key  = HKDF-SHA-256(ikm = prf, salt = empty, info = "segundo/seal/v1/aes-256-gcm") → AES-256-GCM, non-extractable
 *
 * Why a separate salt rather than HKDF from the wallet's PRF output: Mera's PRF calls take a custom 32-byte salt, and a
 * different salt gives an unrelated output (the authenticator computes an HMAC under a secret it keeps), so the
 * sealing key shares nothing with the wallet key: holding one says nothing about the other, and unsealing never needs
 * the wallet key in memory. HKDF on top is still applied so the raw PRF bytes are never used directly as a cipher
 * key and the purpose string versions the format. The cost is a second prompt when you open your details, which is
 * the behaviour people are promised.
 *
 * Each seal uses a fresh 12-byte nonce. The envelope's account, passkey (credential id), format version and seal time are
 * bound in as additional data (version 2), so a sealed file can't be passed off as another account's or another
 * passkey's, and its date can't be edited. Version 1 envelopes, which bound only the account, still open.
 */
import type { Address } from "viem";
import type { Wallet } from "./wallet";

export type PayoutKind = "bank" | "mobile";

export type SealedDetails = {
  legalName: string;
  postalAddress: string;
  country: string;
  taxId: string;
  payoutKind: PayoutKind;
  /** Bank or mobile money provider, e.g. "BDO", "M-Pesa", "GCash". */
  payoutProvider: string;
  /** Account number, IBAN or mobile number. */
  payoutAccount: string;
  updatedAt: string;
};

export type SealedEnvelope = {
  format: "segundo.sealed-details";
  version: 1 | 2;
  account: Address;
  credentialId: string;
  nonce: string;
  ciphertext: string;
  sealedAt: string;
};

export const EMPTY_DETAILS: SealedDetails = {
  legalName: "",
  postalAddress: "",
  country: "",
  taxId: "",
  payoutKind: "bank",
  payoutProvider: "",
  payoutAccount: "",
  updatedAt: "",
};

const INFO = new TextEncoder().encode("segundo/seal/v1/aes-256-gcm");
const FORMAT = "segundo.sealed-details";
const storeKey = (address: string) => `segundo.sealed.v1.${address.toLowerCase()}`;
/** What the cipher authenticates besides the details. Version 1 bound the account only; version 2 binds the whole header. */
function aad(e: Pick<SealedEnvelope, "version" | "account" | "credentialId" | "sealedAt">) {
  const text =
    e.version === 1
      ? `${FORMAT}/v1/${e.account.toLowerCase()}`
      : `${FORMAT}/v2/${e.account.toLowerCase()}/${e.credentialId}/${e.sealedAt}`;
  return new TextEncoder().encode(text);
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** HKDF the sealing-salt PRF output into the AES-256-GCM key, then wipe the PRF bytes. */
export async function deriveSealingKey(prfOutput: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  try {
    const ikm = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: INFO },
      ikm,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    prfOutput.fill(0);
  }
}

/** Only passkey (Mera) accounts can seal: email and practice wallets have no passkey to unlock with. */
export function canSeal(wallet: Wallet): boolean {
  return wallet.kind === "mera" && !!wallet.address && !!wallet.mera;
}

function parseEnvelope(value: unknown): SealedEnvelope {
  const v = (typeof value === "string" ? JSON.parse(value) : value) as Partial<SealedEnvelope> | null;
  if (
    !v ||
    v.format !== FORMAT ||
    (v.version !== 1 && v.version !== 2) ||
    typeof v.account !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(v.account) ||
    typeof v.credentialId !== "string" ||
    typeof v.nonce !== "string" ||
    typeof v.ciphertext !== "string" ||
    unb64url(v.nonce).length !== 12 ||
    unb64url(v.ciphertext).length < 17
  )
    throw new Error("That file isn't a Segundo sealed backup.");
  return {
    format: FORMAT,
    version: v.version,
    account: v.account as Address,
    credentialId: v.credentialId,
    nonce: v.nonce,
    ciphertext: v.ciphertext,
    sealedAt: typeof v.sealedAt === "string" ? v.sealedAt : "",
  };
}

/** The sealed copy kept in this browser for an account, if any. Reading it needs no passkey: it's ciphertext. */
export function readSealed(address: string | undefined): SealedEnvelope | null {
  if (!address) return null;
  try {
    const raw = localStorage.getItem(storeKey(address));
    return raw ? parseEnvelope(raw) : null;
  } catch {
    return null;
  }
}

export function hasSealedDetails(address: string | undefined): boolean {
  return readSealed(address) != null;
}

function store(envelope: SealedEnvelope) {
  localStorage.setItem(storeKey(envelope.account), JSON.stringify(envelope));
  window.dispatchEvent(new CustomEvent("segundo:sealed", { detail: envelope.account }));
}

export function forgetSealed(address: string) {
  try {
    localStorage.removeItem(storeKey(address));
    window.dispatchEvent(new CustomEvent("segundo:sealed", { detail: address }));
  } catch {}
}

async function open(wallet: Wallet, envelope: SealedEnvelope, withKey?: CryptoKey): Promise<SealedDetails> {
  if (!canSeal(wallet)) throw new Error("Sealed details open only with a passkey account.");
  if (envelope.account.toLowerCase() !== wallet.address!.toLowerCase())
    throw new Error(`These details belong to a different Segundo account (${envelope.account.slice(0, 6)}…${envelope.account.slice(-4)}).`);
  const key = withKey ?? (await wallet.mera!.sealingKey());
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64url(envelope.nonce), additionalData: aad(envelope) }, key, unb64url(envelope.ciphertext));
  } catch {
    throw new Error("These details were sealed with a different passkey, or the file was changed. Sign in with the passkey that sealed them.");
  }
  const parsed = JSON.parse(new TextDecoder().decode(plain)) as Partial<SealedDetails>;
  return { ...EMPTY_DETAILS, ...parsed };
}

/** Encrypt and keep the details in this browser. Prompts for the passkey unless it was confirmed in the last few minutes. */
export async function sealDetails(wallet: Wallet, details: SealedDetails): Promise<SealedEnvelope> {
  if (!canSeal(wallet)) throw new Error("Sealing needs a passkey account.");
  const key = await wallet.mera!.sealingKey();
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const header = { version: 2 as const, account: wallet.address!, credentialId: wallet.mera!.credentialId, sealedAt: new Date().toISOString() };
  const body = new TextEncoder().encode(JSON.stringify({ ...details, updatedAt: header.sealedAt }));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(header) }, key, body);
  body.fill(0);
  const envelope: SealedEnvelope = {
    format: FORMAT,
    ...header,
    nonce: b64url(nonce),
    ciphertext: b64url(new Uint8Array(sealed)),
  };
  store(envelope);
  return envelope;
}

/**
 * For any page that prints your own details (invoices, your income statement): returns them, asking for the passkey
 * if it wasn't confirmed in the last few minutes. Null when the account can't seal (email or practice) or nothing is
 * sealed in this browser. Throws an Error with a plain-English message if the prompt is closed or the passkey differs.
 * `withKey` is a sealing key the caller already derived (sharing with a verifier gets it in the same prompt as the
 * disclosure key, lib/disclose.ts).
 */
export async function unsealDetails(wallet: Wallet, withKey?: CryptoKey): Promise<SealedDetails | null> {
  if (!canSeal(wallet)) return null;
  const envelope = readSealed(wallet.address);
  if (!envelope) return null;
  return open(wallet, envelope, withKey);
}

/** The sealed copy as a file to keep anywhere. It's ciphertext: useless without the passkey. */
export function downloadSealedBackup(address: string) {
  const envelope = readSealed(address);
  if (!envelope) throw new Error("There's nothing sealed in this browser yet.");
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `segundo-sealed-${address.slice(2, 8).toLowerCase()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Restore a sealed backup on this device: checks it opens with this passkey before keeping it. */
export async function restoreSealedBackup(wallet: Wallet, text: string): Promise<SealedDetails> {
  let envelope: SealedEnvelope;
  try {
    envelope = parseEnvelope(text);
  } catch {
    throw new Error("That file isn't a Segundo sealed backup.");
  }
  const details = await open(wallet, envelope);
  store(envelope);
  return details;
}
