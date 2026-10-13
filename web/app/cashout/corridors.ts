import type { Address } from "viem";

/**
 * Segundo's demo payout partner on Monad testnet: a plain wallet Segundo holds, standing in for a licensed local
 * partner. Test AUSD cashed out on testnet goes here; no real money moves anywhere.
 */
export const DEMO_PARTNER: Address = "0x092178787c772cbF67c2560B38D9F4f3454677e6";

export type Src = { name: string; url: string };

export const SOURCES = {
  rpw: {
    name: "World Bank, Remittance Prices Worldwide, Issue 54 (Q3 2025)",
    url: "https://remittanceprices.worldbank.org/sites/default/files/2026-04/RPW_main_report_and_annex_Q325.pdf",
  },
  instapay: {
    name: "ABS-CBN News, Bangko Sentral launches InstaPay instant fund transfer system (April 2018)",
    url: "https://news.abs-cbn.com/business/04/23/18/bangko-sentral-launches-instapay-instant-fund-transfer-system",
  },
  nip: { name: "NIBSS, NIBSS Instant Payment (NIP)", url: "https://nibss-plc.com.ng/services/nip" },
  mpesa: { name: "Safaricom, M-PESA business channels and portals", url: "https://safaricom.co.ke/main-mpesa/for-your-business/business-channels" },
  upi: { name: "NPCI, Unified Payments Interface: product overview", url: "https://www.npci.org.in/what-we-do/upi/product-overview" },
  tds: { name: "Income Tax Department of India, Taxation of virtual digital assets", url: "https://incometaxindia.gov.in/w/taxation-of-virtual-digital-asset-vda-" },
  pix: {
    name: "Reuters via Glenbrook, Brazil launches Pix instant payments system (November 2020)",
    url: "https://glenbrook.com/payments_news/brazil-launches-pix-instant-payments-system-whatsapp-to-enter-soon/",
  },
  er: { name: "ExchangeRate-API, open access daily reference rates", url: "https://www.exchangerate-api.com/docs/free" },
} satisfies Record<string, Src>;

export type SourceKey = keyof typeof SOURCES;

export type Rail = {
  id: string;
  /** Where the money lands, as the person would say it: "your GCash". */
  into: string;
  label: string;
  /** The local payment rail the partner pays out on. */
  rail: string;
};

export type Corridor = {
  code: "PHP" | "NGN" | "KES" | "INR" | "BRL";
  country: string;
  rails: Rail[];
  /** What kind of company does the last step. Plain words, no names: none is signed yet. */
  partner: string;
  /** How long until the money is there, and why. */
  arrival: string;
  /** Anything a person in this country should know before cashing out. */
  note: string;
  src: SourceKey[];
};

export const CORRIDORS: Corridor[] = [
  {
    code: "PHP",
    country: "Philippines",
    rails: [
      { id: "gcash", into: "your GCash", label: "GCash", rail: "InstaPay" },
      { id: "bank", into: "your bank account", label: "Bank account", rail: "InstaPay" },
    ],
    partner: "A virtual asset service provider licensed by the Bangko Sentral ng Pilipinas, paying out over InstaPay.",
    arrival: "Usually minutes. InstaPay runs around the clock and credits the receiver in real time; the wait is mostly the partner's own checks.",
    note: "InstaPay was launched with a limit of ₱50,000 per transfer, so a large cash-out is split into several.",
    src: ["instapay"],
  },
  {
    code: "NGN",
    country: "Nigeria",
    rails: [
      { id: "bank", into: "your bank account", label: "Bank account", rail: "NIBSS Instant Payment" },
      { id: "momo", into: "your mobile money wallet", label: "Mobile money", rail: "NIBSS Instant Payment" },
    ],
    partner: "A digital asset operator registered with Nigeria's Securities and Exchange Commission, paying out over NIP.",
    arrival: "Usually minutes. NIP makes funds available in the receiving account in real time, before the banks settle between themselves.",
    note: "Naira rates move quickly; the quote is held for the moment you confirm, not for the day.",
    src: ["nip"],
  },
  {
    code: "KES",
    country: "Kenya",
    rails: [{ id: "mpesa", into: "your M-Pesa", label: "M-Pesa", rail: "M-Pesa business-to-customer payment" }],
    partner: "A licensed payments company with an M-Pesa business account, paying out as a business-to-customer payment.",
    arrival: "Usually minutes. Business-to-customer payments reach the phone as an M-Pesa message.",
    note: "M-Pesa wallets have their own balance and daily limits, set by Safaricom.",
    src: ["mpesa"],
  },
  {
    code: "INR",
    country: "India",
    rails: [
      { id: "upi", into: "your UPI account", label: "UPI", rail: "UPI" },
      { id: "bank", into: "your bank account", label: "Bank account", rail: "IMPS" },
    ],
    partner: "A virtual asset service provider registered with India's Financial Intelligence Unit, paying out over UPI or IMPS.",
    arrival: "Usually minutes. UPI transfers are instant and run every day of the year.",
    note: "India deducts 1% tax at source (section 194S) when a resident is paid for a virtual digital asset, above small yearly thresholds. A partner would deduct it, and it counts towards your income tax for the year.",
    src: ["upi", "tds"],
  },
  {
    code: "BRL",
    country: "Brazil",
    rails: [{ id: "pix", into: "your account by Pix", label: "Pix", rail: "Pix" }],
    partner: "A virtual asset service provider authorised under Brazil's central bank rules, paying out by Pix.",
    arrival: "Usually seconds to minutes. Pix runs 24 hours a day, every day, and is free for individuals.",
    note: "Have your Pix key ready: your CPF, phone number, email or a random key.",
    src: ["pix"],
  },
];

/**
 * The spread a local partner keeps between the mid-market rate and the rate it pays out at. Providers in these
 * markets build it into their quoted rate rather than publishing it per corridor, so this is an assumption, shown
 * as one and adjustable on the page.
 */
export const SPREAD_DEFAULT = 1;
export const SPREAD_MIN = 0.25;
export const SPREAD_MAX = 3;
/** Segundo's share of the partner's spread: an assumption for a revenue-share agreement no partner has signed yet. */
export const SEGUNDO_SHARE = 0.25;
