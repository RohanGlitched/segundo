import "server-only";
import { encodeFunctionData, hexToSignature, isAddress, isHex, type Address, type Hex } from "viem";
import { dollarAbi } from "./chain";

/** An AUSD transferWithAuthorization (EIP-3009) as the browser signs it; numbers arrive as decimal strings. */
export type SignedAuthorization = { from: Address; to: Address; value: string; validBefore: string; nonce: Hex; signature: Hex };

/**
 * Checks the shape of a signed authorisation and encodes the AUSD call the relayer submits for it.
 * Throws when anything is malformed; whether the signature is genuine is for AUSD to say.
 */
export function authorizationCall(a: SignedAuthorization): { value: bigint; validBefore: bigint; data: Hex } {
  if (!a || !isAddress(a.from) || !isAddress(a.to) || !isHex(a.nonce) || a.nonce.length !== 66 || !isHex(a.signature)) throw new Error("malformed");
  const value = BigInt(a.value);
  const validBefore = BigInt(a.validBefore);
  const { r, s, v } = hexToSignature(a.signature);
  const args = [a.from, a.to, value, 0n, validBefore, a.nonce, Number(v ?? 27n), r, s] as const;
  return { value, validBefore, data: encodeFunctionData({ abi: dollarAbi, functionName: "transferWithAuthorization", args }) };
}

/** Same authorisation, same key: lets a route refuse a second copy while the first is on its way. */
export const authorizationKey = (a: Pick<SignedAuthorization, "from" | "nonce">) => `${a.from.toLowerCase()}:${String(a.nonce).toLowerCase()}`;
