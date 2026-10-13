import "server-only";
import { encodeFunctionData, hexToSignature, isAddress, isHex, type Address, type Hex, type LocalAccount } from "viem";
import { DOLLAR, DOLLAR_DOMAIN, dollarAbi, monadTestnet } from "./chain";

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

const transferTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/**
 * A server-held account (the treasury) signs an AUSD transfer authorisation for the relayer to submit.
 * The nonce is chosen by the caller: deriving it from what is being paid back makes AUSD itself refuse a second payment.
 */
export async function authorize(account: LocalAccount, to: Address, value: bigint, nonce: Hex): Promise<SignedAuthorization> {
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 900);
  const signature = await account.signTypedData({
    domain: { ...DOLLAR_DOMAIN, chainId: monadTestnet.id, verifyingContract: DOLLAR },
    types: transferTypes,
    primaryType: "TransferWithAuthorization",
    message: { from: account.address, to, value, validAfter: 0n, validBefore, nonce },
  });
  return { from: account.address, to, value: value.toString(), validBefore: validBefore.toString(), nonce, signature };
}
