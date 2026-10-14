import { createHash } from "node:crypto";
import { verifyMessage, type Hex } from "viem";
import { clientIp, json, limited } from "@/lib/server";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The server copy of a passkey account's sealed details, so a fresh browser on any device finds them and the same
 * passkey opens them there. Only the envelope is kept: AES-256-GCM ciphertext under a key that exists only inside the
 * owner's passkey (lib/seal.ts), with the account and passkey bound in as additional data. Segundo can't read it.
 * Even so, only the account itself can fetch it or replace it: without the account's signature nobody learns whether an
 * address has sealed details at all, or which passkey sealed them.
 *
 *   reading needs a signature over `segundo/sealed/read/v1:<address>:<signedAt>`, at most five minutes old. A passkey
 *   account signs it without a prompt inside an unlocked session, so a fresh browser that has just signed in with the
 *   same passkey fetches the envelope, and the passkey opens it there.
 *   writing needs a signature over `segundo/sealed/v1:<address>:<sha256 of the envelope text>:<signedAt>`, at most five
 *   minutes old, and may not put back an envelope sealed earlier than the one already kept (a replayed upload).
 *
 * GET  ?address=0x…, with headers x-segundo-signed-at (ISO) and x-segundo-signature (or ?at=&sig=)
 *                                                     → the envelope JSON, 404 when there is none, 401 unsigned
 * PUT  { address, envelope (JSON text), sealedAt (ISO, when signed), signature } → { ok: true }, 409 if older
 * 503 when this deployment has no bucket configured; the app then keeps the browser copy and the backup file only.
 */
const MAX_BODY = 8 * 1024;
const MAX_SKEW_MS = 5 * 60_000;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const key = (address: string) => `sealed/${address.toLowerCase()}.json`;
const NO_STORE = { "cache-control": "no-store" };

/** Must match sealUploadMessage in lib/seal.ts. */
const sealMessage =(address: string, envelope: string, sealedAt: string) =>
  `segundo/sealed/v1:${address.toLowerCase()}:${createHash("sha256").update(envelope, "utf8").digest("hex")}:${sealedAt}`;
/** Must match sealReadMessage in lib/seal.ts. */
const readMessage = (address: string, signedAt: string) => `segundo/sealed/read/v1:${address.toLowerCase()}:${signedAt}`;

const fresh = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) && Math.abs(Date.now() - t) <= MAX_SKEW_MS;
};

async function signedBy(address: string, message: string, signature: string): Promise<boolean> {
  try {
    return await verifyMessage({ address: address as Hex, message, signature: signature as Hex });
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  if (limited(`seal:get:${clientIp(req)}`, 60, 60_000)) return json({ error: "Too many requests; try again in a minute." }, 429);
  const q = new URL(req.url).searchParams;
  const address = q.get("address") ?? "";
  // The read challenge: headers from the app (kept out of URLs and logs), or ?at=&sig= for a hand-made request.
  const at = req.headers.get("x-segundo-signed-at") ?? q.get("at") ?? "";
  const sig = req.headers.get("x-segundo-signature") ?? q.get("sig") ?? "";
  if (!ADDRESS.test(address)) return json({ error: "address must be a 0x address" }, 400);
  // Checked before the store is touched, so an unsigned request can't even tell whether anything is sealed.
  if (!at || at.length > 40 || !/^0x[0-9a-fA-F]{2,600}$/.test(sig))
    return json({ error: "Reading a sealed copy needs a signature from the account." }, 401, NO_STORE);
  if (!fresh(at)) return json({ error: "The signature is stale; sign again." }, 401, NO_STORE);
  if (!(await signedBy(address, readMessage(address, at), sig))) return json({ error: "The signature doesn't match this account." }, 401, NO_STORE);
  const store = storage();
  if (!store) return json({ error: "Server copies aren't configured on this deployment." }, 503);
  try {
    const text = await store.read(key(address));
    if (text == null) return json({ error: "Nothing sealed for this account." }, 404, NO_STORE);
    return new Response(text, { status: 200, headers: { "content-type": "application/json", ...NO_STORE } });
  } catch (e) {
    console.error("seal GET", e);
    return json({ error: "Couldn't reach the sealed store." }, 502);
  }
}

export async function PUT(req: Request) {
  if (limited(`seal:put:${clientIp(req)}`, 10, 60_000)) return json({ error: "Too many requests; try again in a minute." }, 429);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "Too large." }, 413);
  let body: { address?: unknown; envelope?: unknown; sealedAt?: unknown; signature?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }
  const { address, envelope, sealedAt, signature } = body;
  if (typeof address !== "string" || !ADDRESS.test(address)) return json({ error: "address must be a 0x address" }, 400);
  if (typeof envelope !== "string" || typeof sealedAt !== "string" || typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature))
    return json({ error: "envelope (JSON text), sealedAt and signature are required" }, 400);

  // The envelope must be a sealed-details envelope for this same account; its contents stay opaque.
  let parsed: { format?: unknown; version?: unknown; account?: unknown; credentialId?: unknown; nonce?: unknown; ciphertext?: unknown; sealedAt?: unknown };
  try {
    parsed = JSON.parse(envelope);
  } catch {
    return json({ error: "envelope must be JSON text" }, 400);
  }
  if (
    parsed?.format !== "segundo.sealed-details" ||
    (parsed.version !== 1 && parsed.version !== 2) ||
    typeof parsed.account !== "string" ||
    parsed.account.toLowerCase() !== address.toLowerCase() ||
    typeof parsed.credentialId !== "string" ||
    typeof parsed.nonce !== "string" ||
    typeof parsed.ciphertext !== "string"
  )
    return json({ error: "That isn't a sealed-details envelope for this account." }, 400);

  if (!fresh(sealedAt)) return json({ error: "The signature is stale; seal again." }, 400);
  if (!(await signedBy(address, sealMessage(address, envelope, sealedAt), signature))) return json({ error: "The signature doesn't match this account." }, 401);

  const store = storage();
  if (!store) return json({ error: "Server copies aren't configured on this deployment." }, 503);
  try {
    // A captured upload replayed within its five minutes must not roll the copy back to an older seal.
    const held = await store.read(key(address));
    if (held != null) {
      let heldAt = "";
      try {
        heldAt = String((JSON.parse(held) as { sealedAt?: unknown }).sealedAt ?? "");
      } catch {}
      const nextAt = typeof parsed.sealedAt === "string" ? parsed.sealedAt : "";
      if (heldAt && nextAt < heldAt) return json({ error: "A newer sealed copy is already kept for this account." }, 409, NO_STORE);
    }
    await store.write(key(address), envelope);
    return json({ ok: true }, 200, NO_STORE);
  } catch (e) {
    console.error("seal PUT", e);
    return json({ error: "Couldn't reach the sealed store." }, 502);
  }
}
