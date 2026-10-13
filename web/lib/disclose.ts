/**
 * Selective disclosure on the income statement: a freelancer shows a landlord or a bank the sealed details they pick
 * (legal name, address, tax ID, payout account), readable by that one verifier only, tied to this statement, and
 * provably from the account the statement is about. Segundo's server never sees anything: both sides run here.
 *
 *  1. The verifier opens /proof/<address>?request=1. Their browser makes a one-time X25519 key pair, keeps the private
 *     half in its localStorage, and shows the public half as a request code and a link to send the freelancer.
 *  2. The freelancer opens their statement with that code, ticks the fields to share and confirms with the passkey.
 *     One fingerprint prompt evaluates two PRF salts: "segundo/seal/v1" opens the sealed details, and
 *     "segundo/disclose/v1" gives the freelancer's disclosure key (lib/keys.ts). The page then
 *       - signs a one-line certificate with the wallet key, "this disclosure key belongs to account 0x…", once (kept
 *         in localStorage, it's public); that signature is what lets the verifier check who sent the details;
 *       - shared = X25519(disclosure secret, verifier public key)
 *       - key    = HKDF-SHA-256(shared, salt = "segundo/disclose/v1", info = "aes-256-gcm|" + verifier key + "|" + sender key)
 *       - AES-256-GCM over the picked fields, with additional data binding the chain, the statement's URL, the block the
 *         statement was read at, and both keys,
 *     and packs it all into one reply token (a link) the freelancer sends back.
 *  3. The verifier's page checks the certificate signature recovers to the statement's account, rebuilds the shared
 *     key with its private half, decrypts, and shows "Verified details for this statement" beside the on-chain totals.
 *
 * Token v1, base64url: 0x01 | first 4 bytes of the verifier's key (to say "made for another browser" plainly) |
 * sender X25519 public key (32) | certificate signature (65) | block, uint64 BE (8) | nonce (12) | AES-GCM ciphertext.
 */
import { x25519 } from "@noble/curves/ed25519";
import { getAddress, hexToBytes, recoverMessageAddress, toHex, type Address, type Hex } from "viem";
import { monadTestnet } from "./chain";
import { disclosureKeys } from "./keys";
import { unsealDetails, type PayoutKind } from "./seal";
import type { Wallet } from "./wallet";

export type DisclosureField = "legalName" | "address" | "taxId" | "payout";
export const DISCLOSURE_FIELDS: { key: DisclosureField; label: string }[] = [
  { key: "legalName", label: "Legal name" },
  { key: "address", label: "Address" },
  { key: "taxId", label: "Tax ID" },
  { key: "payout", label: "Payout account" },
];

export type Disclosed = {
  legalName?: string;
  postalAddress?: string;
  country?: string;
  taxId?: string;
  payoutKind?: PayoutKind;
  payoutProvider?: string;
  payoutAccount?: string;
  sharedAt: string;
};

export type VerifiedDisclosure = { details: Disclosed; account: Address; block: bigint; senderKey: string };

const enc = new TextEncoder();
const LABEL = "segundo/disclose/v1";
const VERSION = 1;
/** Version, verifier hint, sender key, signature, block. */
const HEAD = 1 + 4 + 32 + 65 + 8;
const verifierStore = (a: string) => `segundo.verifier.v1.${a.toLowerCase()}`;
const certStore = (a: string) => `segundo.disclose.cert.v1.${a.toLowerCase()}`;

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("bad base64url");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The statement both sides bind to: same origin, the account's checksummed address, no period or other query. */
export const statementUrl = (address: Address) => `${location.origin}/proof/${getAddress(address)}`;

/** What the wallet key signs once: binds a disclosure public key to the account. */
export const certificateText = (account: Address, key: Uint8Array) =>
  `Segundo disclosure key\n\nAccount ${getAddress(account)}\nMonad testnet, chain ${monadTestnet.id}\nKey ${toHex(key)}\n\nDetails shared with this key come from this account.`;

/* ---------------------------------------------------------------- the verifier's side */

type VerifierRecord = { secret: string; key: string; at: string };

function readVerifier(account: Address): VerifierRecord | null {
  try {
    const v = JSON.parse(localStorage.getItem(verifierStore(account)) || "null") as VerifierRecord | null;
    return v && typeof v.secret === "string" && typeof v.key === "string" ? v : null;
  } catch {
    return null;
  }
}

/** The open request for this statement in this browser, or a new one-time key pair. Returns the public request code. */
export function verifierRequest(account: Address, fresh = false): { code: string; at: string } {
  const old = fresh ? null : readVerifier(account);
  if (old) return { code: old.key, at: old.at };
  const secret = x25519.utils.randomPrivateKey();
  const rec: VerifierRecord = { secret: b64url(secret), key: b64url(x25519.getPublicKey(secret)), at: new Date().toISOString() };
  secret.fill(0);
  localStorage.setItem(verifierStore(account), JSON.stringify(rec));
  return { code: rec.key, at: rec.at };
}

export function hasVerifierRequest(account: Address): boolean {
  return readVerifier(account) != null;
}

export function forgetVerifierRequest(account: Address) {
  try {
    localStorage.removeItem(verifierStore(account));
  } catch {}
}

/** The link the verifier sends: opens the freelancer's statement with the request code filled in. */
export const requestLink = (account: Address, code: string) => `${statementUrl(account)}#verifier=${code}`;

/** A request code pasted on its own or inside the link. */
export function parseRequestCode(text: string): Uint8Array<ArrayBuffer> {
  const m = text.trim().match(/(?:verifier=)?([A-Za-z0-9_-]{43})\s*$/);
  const key = m ? unb64url(m[1]!) : null;
  if (!key || key.length !== 32) throw new Error("That isn't a Segundo request code. Ask the verifier to send their link again.");
  return key;
}

function key(shared: Uint8Array<ArrayBuffer>, verifierKey: Uint8Array, senderKey: Uint8Array, usage: KeyUsage) {
  return crypto.subtle
    .importKey("raw", shared, "HKDF", false, ["deriveKey"])
    .then((base) =>
      crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: enc.encode(LABEL), info: enc.encode(`aes-256-gcm|${b64url(verifierKey)}|${b64url(senderKey)}`) },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        [usage],
      ),
    );
}

const aad = (account: Address, block: bigint, verifierKey: Uint8Array, senderKey: Uint8Array) =>
  enc.encode(`segundo.disclosure/v${VERSION}|chain:${monadTestnet.id}|${statementUrl(account)}|block:${block}|to:${b64url(verifierKey)}|from:${b64url(senderKey)}`);

/** A reply token pasted on its own or inside the link the freelancer sent. */
function parseReply(text: string): Uint8Array<ArrayBuffer> {
  const m = text.trim().match(/(?:reply=)?([A-Za-z0-9_-]{160,})\s*$/);
  if (!m) throw new Error("That isn't a Segundo reply. Ask the freelancer to send the whole link again.");
  return unb64url(m[1]!);
}

/**
 * Opens a reply on the verifier's device: checks the certificate signature recovers to the statement's account, then
 * decrypts with this browser's request key. Throws plain-English errors.
 */
export async function openDisclosure(account: Address, text: string): Promise<VerifiedDisclosure> {
  const t = parseReply(text);
  if (t.length < HEAD + 12 + 17 || t[0] !== VERSION) throw new Error("That isn't a Segundo reply. Ask the freelancer to send the whole link again.");
  const to = t.slice(1, 5);
  const sender = t.slice(5, 37);
  const sig = toHex(t.slice(37, 102)) as Hex;
  const block = new DataView(t.buffer, 102, 8).getBigUint64(0);
  const nonce = t.slice(HEAD, HEAD + 12);
  const body = t.slice(HEAD + 12);

  let signer: Address;
  try {
    signer = await recoverMessageAddress({ message: { raw: toHex(enc.encode(certificateText(account, sender))) }, signature: sig });
  } catch {
    signer = "0x0000000000000000000000000000000000000000";
  }
  if (signer.toLowerCase() !== account.toLowerCase())
    throw new Error("This reply wasn't signed by the account on this statement. Don't rely on it; ask the freelancer to share again from their own statement.");

  const rec = readVerifier(account);
  const mine = rec ? unb64url(rec.key) : null;
  if (!rec || !mine || mine.slice(0, 4).some((b, i) => b !== to[i]))
    throw new Error("This reply was made for a request from another browser. Open it on the device where the request was made, or start a new request and send that.");
  const secret = unb64url(rec.secret);
  let shared: Uint8Array<ArrayBuffer>;
  try {
    shared = Uint8Array.from(x25519.getSharedSecret(secret, sender));
  } catch {
    throw new Error("This reply isn't readable. Ask the freelancer to share again.");
  } finally {
    secret.fill(0);
  }
  let plain: ArrayBuffer;
  try {
    const k = await key(shared, mine, sender, "decrypt");
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(account, block, mine, sender) }, k, body);
  } catch {
    throw new Error("This reply was made for a different request or statement, or was changed on the way. Ask the freelancer to share again using your latest request.");
  } finally {
    shared.fill(0);
  }
  const details = JSON.parse(new TextDecoder().decode(plain)) as Disclosed;
  return { details, account: getAddress(account), block, senderKey: b64url(sender) };
}

/* ---------------------------------------------------------------- the freelancer's side */

/** The wallet signature binding this account's disclosure key: signed once, then reused from this browser. */
async function certificate(wallet: Wallet, account: Address, senderKey: Uint8Array): Promise<Uint8Array> {
  const text = certificateText(account, senderKey);
  try {
    const c = JSON.parse(localStorage.getItem(certStore(account)) || "null") as { key?: string; sig?: Hex } | null;
    if (c?.key === b64url(senderKey) && c.sig) {
      const who = await recoverMessageAddress({ message: { raw: toHex(enc.encode(text)) }, signature: c.sig });
      if (who.toLowerCase() === account.toLowerCase() && hexToBytes(c.sig).length === 65) return hexToBytes(c.sig);
    }
  } catch {}
  const sig = await wallet.signMessage(toHex(enc.encode(text)));
  const bytes = hexToBytes(sig);
  if (bytes.length !== 65) throw new Error("This account's signature can't certify a disclosure key.");
  try {
    localStorage.setItem(certStore(account), JSON.stringify({ key: b64url(senderKey), sig }));
  } catch {}
  return bytes;
}

/**
 * Seals the picked fields for one verifier and returns the reply token. One passkey prompt for the sealing and
 * disclosure keys (unless held), and a wallet signature the first time (silent while the passkey session is open).
 */
export async function shareDetails(
  wallet: Wallet,
  opts: { account: Address; block: bigint; verifierCode: string; fields: DisclosureField[] },
): Promise<string> {
  if (wallet.kind !== "mera" || wallet.address?.toLowerCase() !== opts.account.toLowerCase())
    throw new Error("Only the passkey account this statement belongs to can share its sealed details.");
  if (!opts.fields.length) throw new Error("Pick at least one detail to share.");
  const verifierKey = parseRequestCode(opts.verifierCode);
  const { secret, sealing } = await disclosureKeys(wallet, true);
  const d = await unsealDetails(wallet, sealing);
  if (!d) throw new Error("No sealed details in this browser yet. Add them from your account first.");
  const pick = new Set(opts.fields);
  const out: Disclosed = { sharedAt: new Date().toISOString() };
  if (pick.has("legalName") && d.legalName) out.legalName = d.legalName;
  if (pick.has("address")) {
    if (d.postalAddress) out.postalAddress = d.postalAddress;
    if (d.country) out.country = d.country;
  }
  if (pick.has("taxId") && d.taxId) out.taxId = d.taxId;
  if (pick.has("payout") && d.payoutAccount) {
    out.payoutKind = d.payoutKind;
    out.payoutProvider = d.payoutProvider;
    out.payoutAccount = d.payoutAccount;
  }
  if (Object.keys(out).length === 1) throw new Error("None of the details you picked are filled in. Add them from your account first.");

  const senderKey = x25519.getPublicKey(secret);
  const sig = await certificate(wallet, opts.account, senderKey);
  const shared = Uint8Array.from(x25519.getSharedSecret(secret, verifierKey));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const body = enc.encode(JSON.stringify(out));
  let sealed: ArrayBuffer;
  try {
    const k = await key(shared, verifierKey, senderKey, "encrypt");
    sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(opts.account, opts.block, verifierKey, senderKey) }, k, body);
  } finally {
    shared.fill(0);
    body.fill(0);
  }
  const head = new Uint8Array(HEAD);
  head[0] = VERSION;
  head.set(verifierKey.slice(0, 4), 1);
  head.set(senderKey, 5);
  head.set(sig, 37);
  new DataView(head.buffer).setBigUint64(102, opts.block);
  const token = new Uint8Array(head.length + 12 + sealed.byteLength);
  token.set(head, 0);
  token.set(nonce, head.length);
  token.set(new Uint8Array(sealed), head.length + 12);
  return b64url(token);
}

/** The link the freelancer sends back: opens the verifier's request page with the reply filled in. */
export const replyLink = (account: Address, token: string) => `${statementUrl(account)}?request=1#reply=${token}`;
