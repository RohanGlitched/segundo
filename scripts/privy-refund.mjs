/**
 * Segundo's refund wallet: a Privy server wallet (EVM) owned by an authorization key, under a Privy policy that lets it
 * sign only small AUSD transfers on Monad testnet. Fee refunds (web/lib/refund.ts) are signed by it through Privy.
 *
 *   node scripts/privy-refund.mjs setup              make the authorization key (keys/privy-refund.json, gitignored),
 *                                                    the policy and the wallet, once; prints only ids and the address
 *   node scripts/privy-refund.mjs policy             rewrites the policy's rules (a change signed by the authorization key)
 *   node scripts/privy-refund.mjs status             the wallet, its policy, its MON and AUSD
 *   node scripts/privy-refund.mjs fund [ausd=20] [mon=1]
 *                                                    the faucet wallet sends the refund wallet test AUSD and MON
 *   node scripts/privy-refund.mjs refund <to> [usd=0.01]
 *                                                    a refund-shaped transfer: Privy signs the AUSD authorisation, the keeper submits
 *   node scripts/privy-refund.mjs send <to> [usd=0.01]
 *                                                    an AUSD transfer that Privy itself signs and broadcasts (eth_sendTransaction)
 *   node scripts/privy-refund.mjs deny <to>          asks Privy to sign 51 AUSD and to sign for another token: both must be refused
 *   node scripts/privy-refund.mjs value | vercel env add PRIVY_AUTHORIZATION_KEY production
 *                                                    hands the key to another program; refuses to write it to a terminal
 *
 * The app secret is read in-process from web/.env.local and the authorization key from keys/privy-refund.json; neither
 * is ever printed. Testnet only. Run from the repository root.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { viem, accounts, pub, chain, envKey, ROOT, AUSD, FAUCET_WALLET } from "./bench/lib.mjs";

const FILE = path.join(ROOT, "keys/privy-refund.json");
const API = "https://api.privy.io/v1";
const CAIP2 = "eip155:10143";
/** The most one refund may move: 50 AUSD in base units (AUSD has 6 decimals). */
export const CAP = 50_000_000n;

const [cmd = "status", ...rest] = process.argv.slice(2);
const load = () => (fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : {});
const save = (p) => {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(p, null, 2));
};

function env(name) {
  const text = fs.readFileSync(path.join(ROOT, "web/.env.local"), "utf8");
  const line = text.split(/\r?\n/).find((l) => l.startsWith(name + "="));
  if (!line) throw new Error(`${name} missing from web/.env.local`);
  return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
}

/** RFC 8785 for the plain JSON these requests carry: sorted keys, no whitespace. */
function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
    .join(",")}}`;
}

function authSignature(key, method, url, body, appId) {
  const payload = { version: 1, method, url, body, headers: { "privy-app-id": appId } };
  const der = Buffer.from(key.replace(/^wallet-auth:/, ""), "base64");
  const privateKey = crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return crypto.sign("sha256", Buffer.from(canonical(payload)), privateKey).toString("base64");
}

async function privy(method, p, body, sign = false) {
  const appId = env("NEXT_PUBLIC_PRIVY_APP_ID");
  const secret = env("PRIVY_APP_SECRET");
  const url = API + p;
  const headers = {
    authorization: `Basic ${Buffer.from(`${appId}:${secret}`).toString("base64")}`,
    "privy-app-id": appId,
    "content-type": "application/json",
  };
  if (sign) headers["privy-authorization-signature"] = authSignature(load().authKey, method, url, body, appId);
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const transferTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};
const domainTypes = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
};
const transferAbi = [
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
];

/** The policy: two ALLOW rules; anything that matches neither (another chain, contract, method or a bigger amount) is denied. */
const policyBody = (publicKey) => ({
  version: "1.0",
  name: "Segundo refunds: AUSD on Monad, max 50",
  chain_type: "ethereum",
  owner: { public_key: publicKey },
  rules: [
    {
      name: "Sign AUSD EIP-3009 refunds, max 50 AUSD",
      method: "eth_signTypedData_v4",
      action: "ALLOW",
      conditions: [
        { field_source: "ethereum_typed_data_domain", field: "chainId", operator: "eq", value: "10143" },
        { field_source: "ethereum_typed_data_domain", field: "verifyingContract", operator: "eq", value: AUSD },
        { field_source: "ethereum_typed_data_message", field: "value", operator: "lte", value: CAP.toString(), typed_data: { types: { ...domainTypes, ...transferTypes }, primary_type: "TransferWithAuthorization" } },
      ],
    },
    {
      name: "Send AUSD transfers, max 50 AUSD, no MON",
      method: "eth_sendTransaction",
      action: "ALLOW",
      conditions: [
        { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: "10143" },
        { field_source: "ethereum_transaction", field: "to", operator: "eq", value: AUSD },
        { field_source: "ethereum_transaction", field: "value", operator: "eq", value: "0" },
        { field_source: "ethereum_calldata", field: "transfer.value", operator: "lte", value: CAP.toString(), abi: transferAbi },
      ],
    },
  ],
});

const erc20 = viem.parseAbi(["function balanceOf(address) view returns (uint256)", "function transfer(address, uint256) returns (bool)"]);
const dollar = (n) => (Number(n) / 1e6).toFixed(6);

async function signTransfer(p, to, value, nonce = viem.keccak256(viem.toHex(`segundo:privy-test:${Date.now()}:${Math.random()}`))) {
  const validBefore = Math.floor(Date.now() / 1000) + 900;
  const body = {
    method: "eth_signTypedData_v4",
    caip2: CAIP2,
    params: {
      typed_data: {
        domain: { name: "Agora Dollar", version: "1", chainId: 10143, verifyingContract: AUSD },
        types: {
          ...domainTypes,
          ...transferTypes,
        },
        message: { from: p.address, to, value: value.toString(), validAfter: "0", validBefore: String(validBefore), nonce },
        primary_type: "TransferWithAuthorization",
      },
    },
  };
  const r = await privy("POST", `/wallets/${p.walletId}/rpc`, body, true);
  return { ...r, nonce, validBefore };
}

if (cmd === "setup") {
  const p = load();
  if (!p.authKey) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    p.authKey = "wallet-auth:" + privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    p.publicKey = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    save(p);
    console.log("made an authorization key (kept in keys/privy-refund.json)");
  }
  if (!p.policyId) {
    const r = await privy("POST", "/policies", policyBody(p.publicKey));
    if (r.status !== 200 || !r.data?.id) throw new Error(`policy creation failed (${r.status}): ${JSON.stringify(r.data)}`);
    p.policyId = r.data.id;
    save(p);
    console.log(`policy ${p.policyId}`);
  }
  if (!p.walletId) {
    const r = await privy("POST", "/wallets", { chain_type: "ethereum", display_name: "Segundo refunds", owner: { public_key: p.publicKey }, policy_ids: [p.policyId] });
    if (r.status !== 200 || !r.data?.id) throw new Error(`wallet creation failed (${r.status}): ${JSON.stringify(r.data)}`);
    p.walletId = r.data.id;
    p.address = viem.getAddress(r.data.address);
    save(p);
  }
  console.log(`wallet ${p.walletId} ${p.address} policy ${p.policyId}`);
} else if (cmd === "policy") {
  // Rewrites the policy's rules from policyBody; the policy is owned by the authorization key, so the change is signed.
  const p = load();
  const { name, rules } = policyBody(p.publicKey);
  const r = await privy("PATCH", `/policies/${p.policyId}`, { name, rules }, true);
  if (r.status !== 200) throw new Error(`policy update failed (${r.status}): ${JSON.stringify(r.data)}`);
  console.log(`policy ${r.data.id} updated: ${r.data.rules.map((x) => x.name).join(" | ")}`);
} else if (cmd === "status") {
  const p = load();
  if (!p.walletId) throw new Error("run setup first");
  const w = await privy("GET", `/wallets/${p.walletId}`);
  const pol = await privy("GET", `/policies/${p.policyId}`);
  const [mon, ausd] = await Promise.all([pub.getBalance({ address: p.address }), pub.readContract({ address: AUSD, abi: erc20, functionName: "balanceOf", args: [p.address] })]);
  console.log(JSON.stringify({ wallet: { id: w.data?.id, address: w.data?.address, owner_id: w.data?.owner_id, policy_ids: w.data?.policy_ids }, policy: { id: pol.data?.id, name: pol.data?.name, owner_id: pol.data?.owner_id, rules: pol.data?.rules?.map((r) => r.name) }, mon: viem.formatEther(mon), ausd: dollar(ausd) }, null, 2));
} else if (cmd === "fund") {
  const p = load();
  const usd = Number(rest[0] ?? 20);
  const mon = rest[1] ?? "1";
  const faucet = viem.createWalletClient({ account: accounts.privateKeyToAccount(envKey("FAUCET_KEY")), chain, transport: viem.http(chain.rpcUrls.default.http[0]) });
  if (faucet.account.address.toLowerCase() !== FAUCET_WALLET.toLowerCase()) throw new Error("FAUCET_KEY is not the faucet wallet");
  const a = await faucet.writeContract({ address: AUSD, abi: erc20, functionName: "transfer", args: [p.address, BigInt(Math.round(usd * 1e6))] });
  await pub.waitForTransactionReceipt({ hash: a });
  console.log(`AUSD ${usd} -> ${p.address}: ${a}`);
  const m = await faucet.sendTransaction({ to: p.address, value: viem.parseEther(mon), gas: 21_000n });
  await pub.waitForTransactionReceipt({ hash: m });
  console.log(`MON ${mon} -> ${p.address}: ${m}`);
} else if (cmd === "refund") {
  const p = load();
  const to = viem.getAddress(rest[0]);
  const value = BigInt(Math.round(Number(rest[1] ?? 0.01) * 1e6));
  const s = await signTransfer(p, to, value);
  if (s.status !== 200 || !s.data?.data?.signature) throw new Error(`Privy refused to sign (${s.status}): ${JSON.stringify(s.data)}`);
  const { r, s: ss, v } = viem.hexToSignature(s.data.data.signature);
  const data = viem.encodeFunctionData({
    abi: viem.parseAbi(["function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)"]),
    functionName: "transferWithAuthorization",
    args: [p.address, to, value, 0n, BigInt(s.validBefore), s.nonce, Number(v ?? 27n), r, ss],
  });
  const keeper = viem.createWalletClient({ account: accounts.privateKeyToAccount(envKey("KEEPER_KEY")), chain, transport: viem.http(chain.rpcUrls.default.http[0]) });
  const hash = await keeper.sendTransaction({ to: AUSD, data });
  const rc = await pub.waitForTransactionReceipt({ hash });
  console.log(`refund-shaped transfer ${dollar(value)} AUSD ${p.address} -> ${to}: ${hash} (${rc.status})`);
} else if (cmd === "send") {
  const p = load();
  const to = viem.getAddress(rest[0]);
  const value = BigInt(Math.round(Number(rest[1] ?? 0.01) * 1e6));
  const data = viem.encodeFunctionData({ abi: erc20, functionName: "transfer", args: [to, value] });
  const body = { method: "eth_sendTransaction", caip2: CAIP2, chain_type: "ethereum", params: { transaction: { to: AUSD, data, value: "0x0", chain_id: 10143 } } };
  const r = await privy("POST", `/wallets/${p.walletId}/rpc`, body, true);
  console.log(`eth_sendTransaction (${r.status}): ${JSON.stringify(r.data)}`);
} else if (cmd === "deny") {
  const p = load();
  const to = viem.getAddress(rest[0]);
  const big = await signTransfer(p, to, CAP + 1_000_000n);
  console.log(`51 AUSD authorisation: ${big.status} ${JSON.stringify(big.data)}`);
  const data = viem.encodeFunctionData({ abi: erc20, functionName: "transfer", args: [to, 0n] }); // 0 CTK: would run, so only the policy can stop it
  const other = await privy("POST", `/wallets/${p.walletId}/rpc`, { method: "eth_sendTransaction", caip2: CAIP2, chain_type: "ethereum", params: { transaction: { to: "0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D", data, value: "0x0", chain_id: 10143 } } }, true);
  console.log(`transfer of another token: ${other.status} ${JSON.stringify(other.data)}`);
  const nosig = await privy("POST", `/wallets/${p.walletId}/rpc`, { method: "eth_signTypedData_v4", caip2: CAIP2, params: { typed_data: { domain: {}, types: { EIP712Domain: [] , Note: [{ name: "t", type: "string" }] }, message: { t: "x" }, primary_type: "Note" } } });
  console.log(`unsigned request (app secret only): ${nosig.status} ${JSON.stringify(nosig.data)}`);
} else if (cmd === "value") {
  if (process.stdout.isTTY) throw new Error("refusing to print the key to a terminal; pipe it: node scripts/privy-refund.mjs value | vercel env add PRIVY_AUTHORIZATION_KEY production");
  process.stdout.write(load().authKey);
} else {
  console.log("usage: setup | policy | status | fund [ausd] [mon] | refund <to> [usd] | send <to> [usd] | deny <to> | value");
}
