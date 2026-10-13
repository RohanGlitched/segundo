/**
 * Segundo accounts from a passkey, with Mera (@category-labs/mera).
 *
 * The passkey's WebAuthn PRF output is 32 bytes the authenticator computes from a secret it never releases, the
 * credential, the site and a salt. Same passkey, same site, same salt: same 32 bytes, on any device the passkey is
 * synced to. Segundo uses two salts:
 *   - Mera's default salt: the bytes become BIP-39 entropy, then the wallet key at m/44'/60'/0'/0/0 (standard, so the
 *     account can also be opened by any BIP-39 wallet if the phrase is ever exported);
 *   - SEAL_SALT: an unrelated 32 bytes that only ever become the key for sealed private details (lib/seal.ts).
 *
 * Browser only: this module is imported dynamically from lib/wallet.tsx, never during server rendering. Nothing here
 * writes key material anywhere; localStorage holds the credential id, its transports and the public address.
 */
import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getPasskeyPrfOutput,
  isMeraError,
  type PasskeyCredentialMetadata,
  type Secp256k1SigningSession,
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

/** The page's own host: a passkey is bound to the site it was made on, so the account is too. */
function rpId() {
  return location.hostname;
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

/** sha256("segundo/seal/v1"): the PRF salt for sealed details, never used for anything else. */
async function sealSalt(): Promise<Uint8Array<ArrayBuffer>> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("segundo/seal/v1"));
  return new Uint8Array(digest);
}

/**
 * The passkey's PRF output for the sealing salt. Mera evaluates one salt per prompt, so unsealing is its own
 * fingerprint prompt, separate from signing in, which is also what people are told: details open only when they
 * confirm with their passkey. Limited to the account's own passkey.
 */
export async function sealPrfOutput(credential: PasskeyCredentialMetadata): Promise<Uint8Array<ArrayBuffer>> {
  const got = await getPasskeyPrfOutput({ rpId: rpId(), credential, prfSalt: await sealSalt() });
  if (got.credentialId !== credential.credentialId) {
    got.prfOutput.fill(0);
    throw new Error("That passkey belongs to a different Segundo account. Use the passkey you signed in with.");
  }
  return got.prfOutput;
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
