import { createHash } from "node:crypto";
import { verifyMessage, type Hex } from "viem";
import { clientIp, json, limited } from "@/lib/server";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The server copy of a passkey account's sealed details, so a fresh browser on any device finds them and the same
 * passkey opens them there. Only the envelope is kept: AES-256-GCM ciphertext under a key that exists only inside the
 * owner's passkey (lib/seal.ts), with the account and passkey bound in as additional data. Segundo can't read it, and
 * handing it to anyone else gives them nothing, so reading is open; writing needs the account's signature over
 * `segundo/sealed/v1:<address>:<sha256 of the envelope text>:<signedAt>`, at most five minutes old.
 *
 * GET  ?address=0x…                                   → the envelope JSON, or 404
 * PUT  { address, envelope (JSON text), sealedAt (ISO, when signed), signature } → { ok: true }
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

export async function GET(req: Request) {
  if (limited(`seal:get:${clientIp(req)}`, 60, 60_000)) return json({ error: "Too many requests; try again in a minute." }, 429);
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!ADDRESS.test(address)) return json({ error: "address must be a 0x address" }, 400);
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
  let parsed: { format?: unknown; version?: unknown; account?: unknown; credentialId?: unknown; nonce?: unknown; ciphertext?: unknown };
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

  const signedAt = Date.parse(sealedAt);
  if (!Number.isFinite(signedAt) || Math.abs(Date.now() - signedAt) > MAX_SKEW_MS)
    return json({ error: "The signature is stale; seal again." }, 400);

  let valid = false;
  try {
    valid = await verifyMessage({ address: address as Hex, message: sealMessage(address, envelope, sealedAt), signature: signature as Hex });
  } catch {
    valid = false;
  }
  if (!valid) return json({ error: "The signature doesn't match this account." }, 401);

  const store = storage();
  if (!store) return json({ error: "Server copies aren't configured on this deployment." }, 503);
  try {
    await store.write(key(address), envelope);
    return json({ ok: true }, 200, NO_STORE);
  } catch (e) {
    console.error("seal PUT", e);
    return json({ error: "Couldn't reach the sealed store." }, 502);
  }
}
