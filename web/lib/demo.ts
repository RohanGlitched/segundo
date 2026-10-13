import type { Address } from "viem";

/**
 * Seeded people who keep Till alive on testnet (run by the bots in /bots). The freelancers clock
 * in by themselves a few seconds after someone opens a tab to them, so a judge can try the client
 * side alone.
 */
export const DEMO_FREELANCERS: { address: Address; name: string; place: string; currency: string; work: string }[] = [
  { address: "0x6dbb63ef35dF64E9423776bBf7a4c0a64565A160", name: "Ana Reyes", place: "Manila", currency: "PHP", work: "Brand and logo design" },
  { address: "0x929835102eb2e16F5678C8c3B4830C369D1d4bE0", name: "Tunde Bakare", place: "Lagos", currency: "NGN", work: "Backend development" },
  { address: "0x27fB046863d838e6551EF458AC1e00b7F72F05Cc", name: "Priya Nair", place: "Pune", currency: "INR", work: "Illustration" },
  { address: "0x8340F4d3B05Faa44ec03Ad3Bf5fb2e63B2c84d97", name: "Lucas Almeida", place: "São Paulo", currency: "BRL", work: "Video editing" },
  { address: "0x0117eE8515997AF7D57f2d58f56500B168b709a9", name: "Wanjiru Kamau", place: "Nairobi", currency: "KES", work: "Copywriting" },
];

export const DEMO_CLIENTS: { address: Address; name: string; place: string; currency: string }[] = [
  { address: "0xDbab82aaf0D28547dB05734FE4e5a8AF6C84635C", name: "Northwind Studio", place: "Berlin", currency: "EUR" },
  { address: "0x6833B6CC1B48bd21352559Ea6fba79CaA7b13621", name: "Lumen Labs", place: "Austin", currency: "USD" },
  { address: "0xe3bDcadC352ec1b9230fB63193D493b27E2Dc5d0", name: "Kite & Co", place: "Singapore", currency: "SGD" },
];

/** The two fresh wallets bots/proof.mjs used for the end-to-end proof tab (№ 6, see VERIFY.md). */
export const PROOF_WALLETS: Address[] = ["0x828ac92115c7F12AF1C7A37265C600048dd24F53", "0x2aAEABf549E313f2cF19d2928Ee95603C218AC0c"];

/**
 * Every wallet we run ourselves (the demo studios and freelancers in bots/till-bots.mjs, and the proof script's),
 * lower-cased, so the network numbers can be split into ours and everyone else's.
 */
export const DEMO_WALLETS: ReadonlySet<string> = new Set(
  [...DEMO_CLIENTS.map((c) => c.address), ...DEMO_FREELANCERS.map((f) => f.address), ...PROOF_WALLETS].map((a) => a.toLowerCase()),
);
