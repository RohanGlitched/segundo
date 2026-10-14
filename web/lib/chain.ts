import { createPublicClient, defineChain, http, type Address } from "viem";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"], webSocket: ["wss://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: { default: { name: "MonadVision", url: "https://testnet.monadvision.com" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://testnet-rpc.monad.xyz";

/** Agora's AUSD on Monad testnet (docs.agora.finance/developer/contract-deployments). */
export const DOLLAR: Address = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
export const DOLLAR_SYMBOL = "AUSD";
/** The EIP-712 domain AUSD signs permits and transfer authorisations under. */
export const DOLLAR_DOMAIN = { name: "Agora Dollar", version: "1" } as const;
/** Agora's public testnet faucet: 10,000 AUSD per call. */
export const AGORA_FAUCET: Address = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C";
export const TILL = (process.env.NEXT_PUBLIC_TILL_ADDRESS || "0x0000000000000000000000000000000000000000") as Address;
export const FORWARDER = (process.env.NEXT_PUBLIC_FORWARDER_ADDRESS || "0x0000000000000000000000000000000000000000") as Address;
/** Segundo's treasury: the 1% client fee on every budget and top-up lands here. */
export const TREASURY: Address = "0xAdF0F9443EafD19916cBd8f7541ea5e19e69F62c";

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(RPC_URL, { batch: { wait: 16 }, timeout: 4_000, retryDelay: 100 }),
});

export const explorerTx = (hash: string) => `${monadTestnet.blockExplorers.default.url}/tx/${hash}`;
export const explorerAddress = (a: string) => `${monadTestnet.blockExplorers.default.url}/address/${a}`;

export const dollarAbi = [
  { type: "function", name: "requestFunds", stateMutability: "nonpayable", inputs: [{ name: "recipient", type: "address" }], outputs: [] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;
