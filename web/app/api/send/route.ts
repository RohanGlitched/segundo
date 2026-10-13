import { isAddress, type Hex } from "viem";
import { authorizationCall, authorizationKey, type SignedAuthorization } from "@/lib/authorization";
import { DOLLAR, FORWARDER, TILL, TREASURY, publicClient } from "@/lib/chain";
import { clientIp, json, limited, lowOnGas, revertReason, sendAndWait, signer } from "@/lib/server";

export const runtime = "nodejs";

/** The smallest transfer the relayer pays gas for: one cent. */
const MIN_SEND = 10_000n;
/** AUSD sent to the contracts can never come back out, so the relayer won't deliver it there. */
const NO_INBOX = new Set([TILL, FORWARDER, DOLLAR].map((a) => a.toLowerCase()));
/** Authorisations being sent right now, so two copies of one transfer can't both cost gas. */
const inFlight = new Set<string>();

/** Relays an AUSD transferWithAuthorization (EIP-3009) so people can move their pay without gas. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as SignedAuthorization | null;
  if (!b || !isAddress(b.from) || !isAddress(b.to)) return json({ error: "Enter a valid wallet address." }, 400);
  if (b.from.toLowerCase() === b.to.toLowerCase()) return json({ error: "That's your own wallet." }, 400);
  // The treasury takes fees only, each signed with the open or top-up it pays for; nothing else is relayed to it.
  if (b.to.toLowerCase() === TREASURY.toLowerCase()) return json({ error: "That's Segundo's fee account, which doesn't take transfers. Enter the receiver's wallet address." }, 400);
  if (NO_INBOX.has(b.to.toLowerCase())) return json({ error: "That address is a contract that can't send AUSD back. Enter a person's wallet." }, 400);
  const code = await publicClient.getCode({ address: b.to }).catch(() => undefined);
  if (code && code !== "0x" && !code.startsWith("0xef0100")) return json({ error: "That address is a contract, not a person's wallet. Enter the receiver's wallet address." }, 400);
  let data: Hex;
  try {
    const call = authorizationCall(b);
    if (call.value < MIN_SEND) return json({ error: "The smallest amount the relayer sends is $0.01." }, 400);
    data = call.data;
  } catch {
    return json({ error: "That transfer isn't signed properly. Reload the page and try again." }, 400);
  }
  if (limited(`send:${b.from.toLowerCase()}`, 10, 60_000) || limited(`send-ip:${clientIp(req)}`, 20, 60_000) || limited("send:all", 120, 60_000))
    return json({ error: "Too many transfers in a minute." }, 429);
  const low = await lowOnGas("open");
  if (low) return json({ error: low, lowGas: true }, 503);
  try {
    await publicClient.call({ to: DOLLAR, data });
  } catch (e) {
    const why = revertReason(e);
    return json({ error: /balance/i.test(why) ? "Not enough AUSD in your wallet." : why }, 400);
  }
  const key = authorizationKey(b);
  if (inFlight.has(key)) return json({ error: "That transfer is already on its way." }, 409);
  inFlight.add(key);
  try {
    const { logs: _logs, ...landed } = await sendAndWait(signer("keeper"), { to: DOLLAR, data });
    return json(landed);
  } catch (e) {
    return json({ error: revertReason(e) }, 502);
  } finally {
    inFlight.delete(key);
  }
}
