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

/** Segundo's fee: 1% of every budget and top-up, paid by the client on top, rounded up to the next AUSD unit. */
export const FEE_PERCENT = 1;
export const feeFor = (amount: bigint): bigint => (amount <= 0n ? 0n : (amount + 99n) / 100n);
/** Dollars and cents; four decimals only for an amount under a cent, so it never reads as $0.00. */
export const formatFee = (units: bigint) => formatUsd(toUsd(units), units > 0n && units < 10_000n ? 4 : 2);
/** The same rule for a dollar amount already in USD. */
export const formatCents = (usd: number) => formatUsd(usd, usd > 0 && usd < 0.01 ? 4 : 2);

/** The lowest hourly rate a tab can pay: below it, a second of work is worth less than a hundredth of a cent. */
export const MIN_RATE_USD = 1;

export type ParsedAmount = { units: bigint; problem: null } | { units: null; problem: string };

/**
 * Reads a dollar amount as people type it: "5", "12.50", "$1,000.50", and with a comma as the decimal mark,
 * "2,5" or "1.000,50". With both marks the last one is the decimal mark and the other must group thousands in
 * threes; a lone comma before exactly three digits ("1,000") groups thousands. Exponents ("1e3"), signs and
 * anything past AUSD's six decimals are refused with a plain reason. Exact: no floating point on the way to units.
 */
export function parseAmount(typed: string): ParsedAmount {
  const no = (problem: string): ParsedAmount => ({ units: null, problem });
  const s = typed.replace(/[\s  ]/g, "").replace(/^(US)?\$/i, "");
  if (!s) return no("Enter an amount.");
  if (!/^[\d.,]+$/.test(s)) return no("Use digits only, like 5 or 12.50.");
  const dot = s.lastIndexOf(".");
  const comma = s.lastIndexOf(",");
  let whole: string;
  let frac = "";
  const grouped = (w: string, mark: string) => w.split(mark).every((g, i) => (i === 0 ? /^\d{1,3}$/.test(g) : /^\d{3}$/.test(g)));
  if (dot >= 0 && comma >= 0) {
    const [dec, group] = dot > comma ? [".", ","] : [",", "."];
    const at = s.lastIndexOf(dec);
    whole = s.slice(0, at);
    frac = s.slice(at + 1);
    if (whole.includes(dec) || !grouped(whole, group)) return no("That number mixes commas and points. Write it like 1000.50.");
    whole = whole.split(group).join("");
  } else {
    const mark = dot >= 0 ? "." : comma >= 0 ? "," : null;
    const parts = mark ? s.split(mark) : [s];
    if (parts.length === 1) whole = s;
    else if (parts.length === 2 && !(mark === "," && parts[1]!.length === 3)) [whole, frac] = parts as [string, string];
    else if (grouped(s, mark!)) whole = parts.join("");
    else return no("Write the amount like 1000.50.");
  }
  if (!whole && !frac) return no("Enter an amount.");
  if (frac.length > 6) return no("Use at most six decimal places.");
  const units = BigInt(whole || "0") * DOLLAR_UNIT + BigInt((frac + "000000").slice(0, 6));
  if (units <= 0n) return no("Enter an amount above zero.");
  return { units, problem: null };
}

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
