/**
 * Segundo accounts from a passkey, with Mera (@category-labs/mera).
 *
 * The passkey's WebAuthn PRF output is 32 bytes the authenticator computes from a secret it never releases, the
 * credential, the site and a salt. Same passkey, same site, same salt: same 32 bytes, on any device the passkey is
 * synced to. Segundo uses four salts, one per key family (lib/keys.ts has the whole map, /keys explains it):
 *   - Mera's default salt: the bytes become BIP-39 entropy, then the wallet key at m/44'/60'/0'/0/0 (standard, so the
 *     account can also be opened by any BIP-39 wallet if the phrase is ever exported);
 *   - sha256("segundo/seal/v1"): only ever the key for sealed private details (lib/seal.ts);
 *   - sha256("segundo/invite/v1"): only ever the root of invite keys, one per tab (lib/keys.ts);
 *   - sha256("segundo/disclose/v1"): only ever the X25519 key that shares details with a verifier (lib/disclose.ts).
 * No family is derived from another: a different salt gives an unrelated output, so the wallet key never feeds anything.
 *
 * Browser only: this module is imported dynamically, never during server rendering. Nothing here writes key material
 * anywhere; localStorage holds the credential id, its transports and the public address.
 */
import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getPasskeyPrfOutput,
  isMeraError,
  type PasskeyCredentialMetadata,
  type Secp256k1SigningSession,
  type WebAuthnClient,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeed } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import type { Address, LocalAccount } from "viem";

export const RP_NAME = "Segundo";
const EVM_PATH = "m/44'/60'/0'/0/0";

export type MeraUnlocked = {
  credential: PasskeyCredentialMetadata;
  address: Address;
  session: Secp256k1SigningSession;
  account: LocalAccount<"mera">;
};

/** The relying party passkeys are made for. Fixed, so a look-alike host can't ask for a Segundo account's PRF output. */
const RP_ID = process.env.NEXT_PUBLIC_RP_ID || "segundo.world";
const HOME = `https://${RP_ID}`;

/**
 * Where this page may use passkeys, and under which relying party:
 *   - segundo.world and its subdomains: the fixed RP_ID, so one passkey opens the account on every Segundo page;
 *   - localhost: "localhost", for development and tests;
 *   - *.vercel.app previews: their own hostname (WebAuthn allows nothing else there), with a note that accounts made
 *     on a preview open only on that preview;
 *   - anywhere else: refused, pointing to Segundo's own address.
 */
function relyingParty(): { id: string; note: string | null } | { refused: string } {
  const host = location.hostname;
  if (host === RP_ID || host.endsWith(`.${RP_ID}`)) return { id: RP_ID, note: null };
  if (host === "localhost") return { id: "localhost", note: null };
  if (host.endsWith(".vercel.app")) return { id: host, note: "Passkey accounts made here only open here." };
  return { refused: `Passkey accounts open only on Segundo's own address. Go to ${HOME} to use your passkey.` };
}

/** The page's relying party id; throws a plain-English Error on a host that isn't Segundo's. */
function rpId(): string {
  const rp = relyingParty();
  if ("refused" in rp) throw new Error(rp.refused);
  return rp.id;
}

/** For sign-in screens: a one-line caution on preview hosts, or the refusal on a foreign host; null on segundo.world. */
export function passkeyHostNote(): string | null {
  if (typeof location === "undefined") return null;
  const rp = relyingParty();
  return "refused" in rp ? rp.refused : rp.note;
}

/** PRF output → BIP-39 entropy → seed → BIP-44 Ethereum key, then a Mera signing session that owns a copy of it. */
async function openSession(prfOutput: Uint8Array<ArrayBuffer>) {
  let seed: Uint8Array | undefined;
  let master: HDKey | undefined;
  let node: HDKey | undefined;
  let key: Uint8Array | undefined;
  try {
    const mnemonic = entropyToMnemonic(prfOutput, wordlist);
    seed = await mnemonicToSeed(mnemonic);
    master = HDKey.fromMasterSeed(seed);
    node = master.derive(EVM_PATH);
    if (!node.privateKey) throw new Error("This passkey couldn't make a Segundo account. Try again, or continue with email.");
    key = Uint8Array.from(node.privateKey);
    const session = createSecp256k1SigningSession({ privateKey: key });
    const account = toViemAccount(session);
    return { session, account, address: account.address };
  } finally {
    prfOutput.fill(0);
    seed?.fill(0);
    key?.fill(0);
    node?.wipePrivateData();
    master?.wipePrivateData();
  }
}

/** First visit: make a new passkey for Segundo on this device and open its account. One or two prompts. */
export async function createAccount(): Promise<MeraUnlocked> {
  const day = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const created = await createPasskeyWithPrfOutput({
    rp: { id: rpId(), name: RP_NAME },
    user: { name: `Segundo account, ${day}`, displayName: "Segundo account" },
  });
  const credential: PasskeyCredentialMetadata = {
    credentialId: created.credentialId,
    ...(created.transports ? { transports: [...created.transports] } : {}),
  };
  return { credential, ...(await openSession(created.prfOutput)) };
}

/**
 * Returning visit, or a signing session that expired: ask the passkey again. With `credential` the prompt is limited
 * to that passkey; without it (a new device) the browser lists every Segundo passkey the person has.
 */
export async function unlockAccount(credential?: PasskeyCredentialMetadata): Promise<MeraUnlocked> {
  const got = await getPasskeyPrfOutput({ rpId: rpId(), ...(credential ? { credential } : {}) });
  const same = credential?.credentialId === got.credentialId;
  const meta: PasskeyCredentialMetadata = same && credential ? credential : { credentialId: got.credentialId };
  return { credential: meta, ...(await openSession(got.prfOutput)) };
}

/** The non-wallet key families and the label each PRF salt is hashed from. A label is never reused for anything else. */
export const FAMILY_LABELS = {
  seal: "segundo/seal/v1",
  invite: "segundo/invite/v1",
  disclose: "segundo/disclose/v1",
} as const;
export type Family = keyof typeof FAMILY_LABELS;

/** sha256(label): the 32-byte PRF salt for a family. */
async function saltOf(family: Family): Promise<Uint8Array<ArrayBuffer>> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(FAMILY_LABELS[family]));
  return new Uint8Array(digest);
}

const bytes = (v: BufferSource): Uint8Array =>
  v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

/**
 * A WebAuthn client for Mera that asks the authenticator for both PRF outputs WebAuthn allows in one assertion
 * ("first" and "second"). Mera reads "first" as usual; "second" is handed to `keep`. Everything else matches Mera's
 * own browser client, so its checks and errors still apply.
 */
function twoSaltClient(second: Uint8Array<ArrayBuffer>, keep: (out: Uint8Array) => void): WebAuthnClient {
  return {
    createCredential: () => Promise.reject(new Error("Not used for key families.")),
    async getCredential(request) {
      const allow = request.allowCredential;
      const credential = (await navigator.credentials.get({
        publicKey: {
          rpId: request.rpId,
          challenge: request.challenge,
          ...(request.timeout !== undefined ? { timeout: request.timeout } : {}),
          userVerification: request.userVerification,
          extensions: { prf: { eval: { first: request.prfSalt, second } } },
          ...(allow
            ? { allowCredentials: [{ id: allow.credentialId, type: "public-key" as const, ...(allow.transports ? { transports: allow.transports as AuthenticatorTransport[] } : {}) }] }
            : {}),
        },
      })) as PublicKeyCredential | null;
      if (!credential || credential.type !== "public-key") throw new Error("The passkey prompt returned nothing.");
      const results = credential.getClientExtensionResults().prf?.results;
      if (results?.second) keep(bytes(results.second).slice());
      return {
        credentialId: new Uint8Array(credential.rawId),
        ...(results?.first ? { prfOutput: bytes(results.first).slice() } : {}),
      };
    },
  };
}

/** One assertion limited to the account's passkey; refuses a different passkey and wipes what it returned. */
async function familyAssertion(credential: PasskeyCredentialMetadata, family: Family, client?: WebAuthnClient) {
  const got = await getPasskeyPrfOutput({ rpId: rpId(), credential, prfSalt: await saltOf(family), ...(client ? { webAuthnClient: client } : {}) });
  if (got.credentialId !== credential.credentialId) {
    got.prfOutput.fill(0);
    throw new Error("That passkey belongs to a different Segundo account. Use the passkey you signed in with.");
  }
  return got.prfOutput;
}

/**
 * PRF outputs for one or two key families with as few fingerprint prompts as the authenticator allows. Mera's
 * getPasskeyPrfOutput evaluates one salt; WebAuthn lets one assertion evaluate two, so a second family rides along as
 * "second" through a custom Mera WebAuthn client. If the authenticator returns only "first", the second family gets
 * its own prompt. Each output is the PRF for that family's own salt: nothing is derived from anything else.
 */
export async function familyPrfOutputs<F extends Family>(credential: PasskeyCredentialMetadata, families: readonly [F] | readonly [F, F]): Promise<Record<F, Uint8Array<ArrayBuffer>>> {
  const [a, b] = families;
  const out = {} as Record<F, Uint8Array<ArrayBuffer>>;
  if (!b) {
    out[a] = await familyAssertion(credential, a);
    return out;
  }
  let second: Uint8Array | null = null;
  const firstOut = await familyAssertion(
    credential,
    a,
    twoSaltClient(await saltOf(b), (v) => {
      second = v;
    }),
  );
  out[a] = firstOut;
  const s = second as Uint8Array | null;
  if (s && s.length === 32) out[b] = Uint8Array.from(s);
  else {
    try {
      out[b] = await familyAssertion(credential, b);
    } catch (e) {
      firstOut.fill(0);
      throw e;
    }
  }
  s?.fill(0);
  return out;
}

/**
 * The passkey's PRF output for the sealing salt. Unsealing is its own fingerprint prompt, separate from signing in,
 * which is also what people are told: details open only when they confirm with their passkey.
 */
export async function sealPrfOutput(credential: PasskeyCredentialMetadata): Promise<Uint8Array<ArrayBuffer>> {
  return (await familyPrfOutputs(credential, ["seal"] as const)).seal;
}

/** Whether this browser can try a passkey at all. PRF support is only known once the passkey answers. */
export function passkeysPossible() {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && window.isSecureContext;
}

/** Mera's error codes in plain words. Wording avoids the phrases lib/relay.ts rewrites (so these reach people as is). */
export function meraMessage(e: unknown): string {
  if (isMeraError(e)) {
    const cause = (e as { cause?: unknown }).cause;
    const name = cause instanceof Error ? cause.name : "";
    switch (e.code) {
      case "PRF_UNAVAILABLE":
        return "This passkey can't make a Segundo account. On a computer, save it to Google Password Manager or iCloud Keychain, or continue with email.";
      case "CRYPTO_UNAVAILABLE":
        return "Passkeys only work on Segundo's secure (https) address. Open it there, or continue with email.";
      case "SESSION_ENDED":
        return "Your passkey session ended. Try again and confirm with your passkey.";
      case "DECRYPT_FAILED":
        return "These details were sealed with a different passkey, or the file was changed. Sign in with the passkey that sealed them.";
      case "PASSKEY_OPERATION_FAILED":
        if (!passkeysPossible()) return "This browser can't use passkeys. Continue with email instead.";
        if (name === "InvalidStateError") return "This device already has a Segundo passkey. Choose “Sign back in with your passkey”.";
        if (name === "NotAllowedError" || name === "AbortError")
          return "The passkey prompt was closed or ran out of time. Try again, or continue with email.";
        return "This device couldn't use a passkey here. Try again, or continue with email.";
      default:
        return "Something went wrong with the passkey. Try again, or continue with email.";
    }
  }
  return e instanceof Error ? e.message : String(e);
}
