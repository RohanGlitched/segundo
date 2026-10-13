/**
 * Sealed details: a freelancer's legal name, address, tax ID and payout account, encrypted in the browser with a
 * key that only their passkey can produce. Segundo's servers never receive them open: they keep only the sealed
 * envelope (app/api/seal), so a fresh browser on any device finds it and the same passkey opens it there.
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
import { toHex, type Address } from "viem";
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

/**
 * The sealed copy kept in this browser for an account, if any. Reading it needs no passkey: it's ciphertext. The same
 * envelope is kept on Segundo's server (uploadSealed, fetchSealed), so on another device or a fresh browser profile
 * loadSealed finds it and the same passkey opens it there; the backup file (downloadSealedBackup, restoreSealedBackup)
 * still works without the server.
 */
export function readSealed(address: string | undefined): SealedEnvelope | null {
  if (!address) return null;
  try {
    const raw = localStorage.getItem(storeKey(address));
    return raw ? parseEnvelope(raw) : null;
  } catch {
    return null;
  }
}

/** True when this browser holds a sealed copy. When it doesn't, looks for the server copy once in the background:
 *  if there is one, it is cached here and a "segundo:sealed" event fires. */
export function hasSealedDetails(address: string | undefined): boolean {
  const here = readSealed(address) != null;
  if (!here && address && typeof window !== "undefined") void fetchSealed(address);
  return here;
}

/* ---------- The server copy (ciphertext only) ---------- */

const fetched = new Map<string, Promise<SealedEnvelope | null>>();

async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What the account signs to store an envelope; app/api/seal/route.ts checks the same text. */
export async function sealUploadMessage(address: string, envelopeText: string, signedAt: string): Promise<string> {
  return `segundo/sealed/v1:${address.toLowerCase()}:${await sha256Hex(envelopeText)}:${signedAt}`;
}

/**
 * The envelope Segundo's server keeps for an account, cached in this browser when found. Null when there is none, the
 * deployment keeps no server copies (503), or the network fails: the caller carries on with what this browser has.
 * One request per address per page load unless `again`.
 */
export function fetchSealed(address: string, again = false): Promise<SealedEnvelope | null> {
  const k = address.toLowerCase();
  if (!again && fetched.has(k)) return fetched.get(k)!;
  const p = (async () => {
    try {
      const r = await fetch(`/api/seal?address=${k}`, { cache: "no-store" });
      if (!r.ok) return null;
      const envelope = parseEnvelope(await r.text());
      if (envelope.account.toLowerCase() !== k) return null;
      const local = readSealed(address);
      // Never replace a newer copy this browser sealed with an older one from the server.
      if (!local || (envelope.sealedAt || "") > (local.sealedAt || "")) store(envelope);
      return envelope;
    } catch {
      return null;
    }
  })();
  fetched.set(k, p);
  return p;
}

/** This browser's sealed copy, or the server's when this browser has none (then cached here). */
export async function loadSealed(address: string | undefined): Promise<SealedEnvelope | null> {
  if (!address) return null;
  return readSealed(address) ?? (await fetchSealed(address));
}

/**
 * Keeps the envelope on Segundo's server, signed by the account so nobody else can replace it. Passkey accounts sign
 * this without a prompt inside an unlocked session (and with one when signing is locked). Returns false, without
 * throwing, when the deployment keeps no server copies, the prompt is closed or the network fails: the browser copy
 * and the backup file still hold the details.
 */
export async function uploadSealed(wallet: Wallet, envelope: SealedEnvelope): Promise<boolean> {
  if (!canSeal(wallet) || envelope.account.toLowerCase() !== wallet.address!.toLowerCase()) return false;
  try {
    const text = JSON.stringify(envelope);
    const signedAt = new Date().toISOString();
    const message = await sealUploadMessage(envelope.account, text, signedAt);
    const signature = await wallet.signMessage(toHex(new TextEncoder().encode(message)));
    const r = await fetch("/api/seal", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: envelope.account, envelope: text, sealedAt: signedAt, signature }),
    });
    if (r.ok) fetched.set(envelope.account.toLowerCase(), Promise.resolve(envelope));
    return r.ok;
  } catch {
    return false;
  }
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
  // Reading details always asks for the passkey, even mid-session: the plain text is never one unattended tap away.
  const key = withKey ?? (await wallet.mera!.sealingKey({ fresh: true }));
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64url(envelope.nonce), additionalData: aad(envelope) }, key, unb64url(envelope.ciphertext));
  } catch {
    throw new Error("These details were sealed with a different passkey, or the file was changed. Sign in with the passkey that sealed them.");
  }
  const parsed = JSON.parse(new TextDecoder().decode(plain)) as Partial<SealedDetails>;
  return { ...EMPTY_DETAILS, ...parsed };
}

/** Encrypt and keep the details in this browser (uploadSealed then keeps the envelope on the server). Prompts for the passkey unless the sealing key is already in this session. */
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
 * every time (a fresh assertion on the sealing salt, even inside an unlocked session). Null when the account can't seal (email or practice) or nothing is
 * sealed in this browser or on Segundo's server. Throws an Error with a plain-English message if the prompt is closed or the passkey differs.
 * `withKey` is a sealing key the caller already derived (sharing with a verifier gets it in the same prompt as the
 * disclosure key, lib/disclose.ts), so that prompt is the fresh one.
 */
export async function unsealDetails(wallet: Wallet, withKey?: CryptoKey): Promise<SealedDetails | null> {
  if (!canSeal(wallet)) return null;
  const envelope = await loadSealed(wallet.address);
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
