/** Currencies people think in, each with its own ink, the way banknotes have their own colours. */
export type Currency = {
  code: string;
  name: string;
  symbol: string;
  ink: string; // light theme
  inkNight: string; // dark theme
  digits: number; // decimals shown on the note
};

export const CURRENCIES: Currency[] = [
  { code: "USD", name: "US dollar", symbol: "$", ink: "#2F6B4F", inkNight: "#7FCBA4", digits: 2 },
  { code: "INR", name: "Indian rupee", symbol: "₹", ink: "#7B3FA0", inkNight: "#C9A2E8", digits: 2 },
  { code: "PHP", name: "Philippine peso", symbol: "₱", ink: "#2557B0", inkNight: "#93B4F2", digits: 2 },
  { code: "NGN", name: "Nigerian naira", symbol: "₦", ink: "#1F7A4D", inkNight: "#7BD3A4", digits: 2 },
  { code: "BRL", name: "Brazilian real", symbol: "R$", ink: "#11777A", inkNight: "#79CFD1", digits: 2 },
  { code: "KES", name: "Kenyan shilling", symbol: "KSh", ink: "#9A5A12", inkNight: "#E7B477", digits: 2 },
  { code: "PKR", name: "Pakistani rupee", symbol: "Rs", ink: "#3D7A2A", inkNight: "#9FD58A", digits: 2 },
  { code: "IDR", name: "Indonesian rupiah", symbol: "Rp", ink: "#B0303A", inkNight: "#F09AA1", digits: 0 },
  { code: "MXN", name: "Mexican peso", symbol: "MX$", ink: "#6A4BB0", inkNight: "#B9A6F0", digits: 2 },
  { code: "EUR", name: "Euro", symbol: "€", ink: "#2E5FA8", inkNight: "#98B6EA", digits: 2 },
  { code: "GBP", name: "Pound sterling", symbol: "£", ink: "#8E2F3C", inkNight: "#EB9AA5", digits: 2 },
  { code: "SGD", name: "Singapore dollar", symbol: "S$", ink: "#A3364F", inkNight: "#EE9DB0", digits: 2 },
];

export const currency = (code?: string): Currency => CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];

/** AUSD has 6 decimals. */
export const DOLLAR_UNIT = 1_000_000n;
export const toUsd = (units: bigint | number) => Number(units) / 1e6;
export const toUnits = (usd: number) => BigInt(Math.round(usd * 1e6));

export type Rates = Record<string, number>;

/** Splits an amount into the pieces the note prints: symbol, whole part with grouping, and decimals. */
export function noteParts(usd: number, cur: Currency, rates: Rates | null) {
  const rate = cur.code === "USD" ? 1 : rates?.[cur.code];
  if (rate == null) return null;
  const value = usd * rate;
  const fixed = value.toFixed(cur.digits);
  const [whole, frac] = fixed.split(".");
  const grouped = Number(whole).toLocaleString(cur.code === "INR" ? "en-IN" : "en-US");
  return { symbol: cur.symbol, whole: grouped, frac: frac ?? "", value };
}

export function formatMoney(usd: number, cur: Currency, rates: Rates | null): string {
  const p = noteParts(usd, cur, rates);
  if (!p) return "—";
  return `${p.symbol}${p.whole}${p.frac ? "." + p.frac : ""}`;
}

export const formatUsd = (usd: number, digits = 2) =>
  `$${usd.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

/** Hourly rate in AUSD units to a per-hour USD number. */
export const ratePerHour = (rate: bigint) => toUsd(rate);

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s % 60} s`;
  return `${s} s`;
}

/** "2 seconds ago", "4 min ago": short, human, no jargon. */
export function ago(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 2) return "just now";
  if (s < 60) return `${s} seconds ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}
