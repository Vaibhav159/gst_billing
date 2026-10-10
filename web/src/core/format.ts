// Formatting. ALL money in the app is integer paise (₹87,083.21 is
// 8708321). Quantities are plain numbers with up to 3 decimals. Dates are ISO
// strings "2026-10-08"; months are "2026-10".

const MINUS = "−";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Indian digit grouping of a non-negative integer: 23200075 -> "2,32,00,075". */
export function groupIN(n: number): string {
  const s = String(Math.trunc(Math.abs(n)));
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return rest + "," + last3;
}

/** "₹87,083.21"; whole: true gives "₹2,32,00,075" (rounded to the rupee). */
export function inr(paise: number | null | undefined, { whole = false, sign = false }: { whole?: boolean; sign?: boolean } = {}): string {
  if (paise == null || Number.isNaN(paise)) return "—";
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  let body;
  if (whole) body = "₹" + groupIN(Math.round(abs / 100));
  else body = "₹" + groupIN(Math.floor(abs / 100)) + "." + String(abs % 100).padStart(2, "0");
  if (neg) return MINUS + body;
  if (sign && paise > 0) return "+" + body;
  return body;
}

/** Split for display: { neg, sym: "₹", rupees: "87,083", paise: ".21" }. */
export function inrParts(paise: number, { whole = false }: { whole?: boolean } = {}): { neg: boolean; sym: "₹"; rupees: string; paise: string } {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise || 0));
  if (whole) return { neg, sym: "₹", rupees: groupIN(Math.round(abs / 100)), paise: "" };
  return { neg, sym: "₹", rupees: groupIN(Math.floor(abs / 100)), paise: "." + String(abs % 100).padStart(2, "0") };
}

/** Rupees typed by a person -> paise, or null. Accepts "6,512.50", "6512.5", "₹ 87083.21". */
export function parseRupees(text: string | null | undefined): number | null {
  if (text == null) return null;
  const t = String(text).replace(/[₹,\s]/g, "");
  if (t === "" || !/^\d*\.?\d{0,2}$/.test(t)) return null;
  const [r, p = ""] = t.split(".");
  return Number(r || 0) * 100 + Number((p + "00").slice(0, 2));
}

/** Paise -> plain rupee text for an input: 651250 -> "6512.50". */
export function paiseToInput(paise: number | null | undefined): string {
  if (paise == null) return "";
  return (paise / 100).toFixed(2);
}

/** Every unit the server accepts, with how many decimals a quantity keeps. */
export const UNITS: { value: string; label: string; decimals: number }[] = [
  { value: "g", label: "Grams (g)", decimals: 3 }, { value: "gms", label: "Grams (gms)", decimals: 3 }, { value: "kg", label: "Kilograms (kg)", decimals: 3 },
  { value: "ct", label: "Carat (ct)", decimals: 3 }, { value: "tola", label: "Tola", decimals: 3 }, { value: "oz", label: "Ounce (oz)", decimals: 3 },
  { value: "pcs", label: "Pieces (pcs)", decimals: 0 }, { value: "nos", label: "Numbers (nos)", decimals: 0 }, { value: "unit", label: "Unit", decimals: 0 },
  { value: "pair", label: "Pair", decimals: 0 }, { value: "set", label: "Set", decimals: 0 }, { value: "dozen", label: "Dozen", decimals: 0 },
  { value: "box", label: "Box", decimals: 0 }, { value: "mtr", label: "Meters (mtr)", decimals: 2 }, { value: "ltr", label: "Litres (ltr)", decimals: 2 },
  { value: "ml", label: "Millilitres (ml)", decimals: 0 },
];
export function unitDecimals(unit: string): number { return UNITS.find((u) => u.value === unit)?.decimals ?? 3; }

/** Quantity with its unit's decimals: qty(12.345, "g") -> "12.345 g", qty(4, "pcs") -> "4 pcs". */
export function qty(n: number | null | undefined, unit = "g"): string {
  if (n == null) return "—";
  const d = unitDecimals(unit);
  const s = Number(n).toFixed(d);
  const [a, b] = s.split(".");
  return groupIN(Number(a)) + (b ? "." + b : "") + (unit ? " " + unitLabel(unit) : "");
}
export function unitLabel(unit: string): string {
  return unit || "";
}
/** 1 tola = 11.664 g (the bullion trade's measure). */
export const TOLA_G = 11.664;

/** GST slab as text: 0.03 -> "3%", 0.0025 -> "0.25%", 0.015 -> "1.5%". */
export function pct(rate: number): string {
  const p = Math.round(rate * 100000) / 1000;
  return (Number.isInteger(p) ? String(p) : String(p).replace(/0+$/, "")) + "%";
}

export function plural(n: number, one: string, many?: string): string {
  return `${groupIN(n)} ${n === 1 ? one : many || one + "s"}`;
}

/** "08 Oct 2026" */
export function date(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}
/** "08 Oct" */
export function dateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]}`;
}
/** "Thursday, 08 Oct 2026" */
export function dateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[wd]}, ${date(iso)}`;
}
export function weekday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
/** "Sep 2026" / long: "September 2026" */
export function monthLabel(ym: string, { long = false, year = true }: { long?: boolean; year?: boolean } = {}): string {
  const [y, m] = ym.split("-").map(Number);
  const name = long ? MONTHS_LONG[m - 1] : MONTHS[m - 1];
  return year ? `${name} ${y}` : name;
}
export function monthOf(iso: string): string { return iso.slice(0, 7); }
export function addMonths(ym: string, n: number): string {
  let [y, m] = ym.split("-").map(Number);
  m += n;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}
export function daysBetween(aIso: string, bIso: string): number {
  const a = Date.UTC(...(aIso.split("-").map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))) as [number, number, number]));
  const b = Date.UTC(...(bIso.split("-").map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))) as [number, number, number]));
  return Math.round((b - a) / 86400000);
}
export function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}
/** Financial year months for "2026-27": 2026-04 .. 2027-03 */
export function fyMonths(fy = "2026-27"): string[] {
  const y = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => addMonths(`${y}-04`, i));
}
export function fyOf(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
/** "1 to 8 Oct 2026" */
export function rangeLabel(fromIso: string, toIso: string): string {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  if (fy === ty && fm === tm) return `${fd} to ${td} ${MONTHS[tm - 1]} ${ty}`;
  if (fy === ty) return `${fd} ${MONTHS[fm - 1]} to ${td} ${MONTHS[tm - 1]} ${ty}`;
  return `${date(fromIso)} to ${date(toIso)}`;
}

/** Indian-system amount in words for a bill: 8708321 -> "Eighty Seven Thousand Eighty Three Rupees and Twenty One Paise Only" */
export function amountInWords(paise: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n: number): string => (n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : ""));
  const three = (n: number): string => {
    const h = Math.floor(n / 100), r = n % 100;
    return [h ? ones[h] + " Hundred" : "", r ? two(r) : ""].filter(Boolean).join(" ");
  };
  const words = (n: number): string => {
    if (n === 0) return "Zero";
    const parts = [];
    const crore = Math.floor(n / 10000000); n %= 10000000;
    const lakh = Math.floor(n / 100000); n %= 100000;
    const thousand = Math.floor(n / 1000); n %= 1000;
    if (crore) parts.push(words(crore) + " Crore");
    if (lakh) parts.push(two(lakh) + " Lakh");
    if (thousand) parts.push(two(thousand) + " Thousand");
    if (n) parts.push(three(n));
    return parts.join(" ");
  };
  const abs = Math.abs(Math.round(paise));
  const r = Math.floor(abs / 100), p = abs % 100;
  return `${words(r)} Rupees${p ? " and " + two(p) + " Paise" : ""} Only`;
}

/** Initials for an avatar: "Anil Gupta" -> "AG" */
export function initials(name = ""): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
}

/** "98290 41122" -> "+91 98290 41122" */
export function phone(p: string | null | undefined): string { return p ? `+91 ${p}` : ""; }

/** A mobile number in two groups, as it's read out: "9829041122" -> "98290 41122". Anything else (a landline, a +91) as typed. */
export function mobileText(m: string | null | undefined): string {
  const s = (m ?? "").trim();
  return /^[6-9]\d{9}$/.test(s) ? `${s.slice(0, 5)} ${s.slice(5)}` : s;
}

/** The API's decimal ("87083.21", or a number) -> integer paise, rounding the third decimal half-up as the server does. */
export function toPaise(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const s = typeof v === "number" ? String(v) : v.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = (m[3] || "").padEnd(3, "0");
  const p = Number(m[2]) * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0);
  return m[1] ? -p : p;
}

/** Integer paise -> the decimal string the API takes: 8708321 -> "87083.21". */
export function paiseToDecimal(p: number): string {
  const a = Math.abs(Math.round(p));
  return `${p < 0 ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/** Today's date in India ("2026-10-09"), whatever zone the device's clock is set to. */
export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
