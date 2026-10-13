// 2026-10-13 — shared money formatting for B2B documents & UI, from the PI
// review: "Total amount ka format galat hai — USD 2,800,000.00 likhein"
// (international grouping with the ISO code, NOT en-IN's 28,00,000) and
// "Amount in words: Two Million Eight Hundred Thousand United States Dollars
// Only."
//
// Rules:
//   • INR keeps the domestic convention (₹28,00,000.00 — lakh grouping is
//     correct for Indian invoices and is what every other page prints).
//   • Every other currency prints ISO code + international (en-US) grouping:
//     USD 2,800,000.00. The ISO code is explicit so a printed PI can never
//     be misread as another currency.
//   • Amount in words uses the Indian scale for INR (crore/lakh) and the
//     international short scale for everything else (million/billion) —
//     matching how each currency's invoices are actually written.
//   • Nothing here guesses trade facts: words are derived only from the
//     computed total.

const CURRENCY_NAMES: Record<string, { plural: string; singular: string }> = {
  USD: { plural: "United States Dollars", singular: "United States Dollar" },
  INR: { plural: "Indian Rupees", singular: "Indian Rupee" },
  EUR: { plural: "Euros", singular: "Euro" },
  GBP: { plural: "Pounds Sterling", singular: "Pound Sterling" },
  AED: { plural: "UAE Dirhams", singular: "UAE Dirham" },
  SAR: { plural: "Saudi Riyals", singular: "Saudi Riyal" },
  QAR: { plural: "Qatari Riyals", singular: "Qatari Riyal" },
  KWD: { plural: "Kuwaiti Dinars", singular: "Kuwaiti Dinar" },
  BHD: { plural: "Bahraini Dinars", singular: "Bahraini Dinar" },
  OMR: { plural: "Omani Rials", singular: "Omani Rial" },
  NGN: { plural: "Nigerian Naira", singular: "Nigerian Naira" },
  JPY: { plural: "Japanese Yen", singular: "Japanese Yen" },
  CNY: { plural: "Chinese Yuan", singular: "Chinese Yuan" },
  AUD: { plural: "Australian Dollars", singular: "Australian Dollar" },
  CAD: { plural: "Canadian Dollars", singular: "Canadian Dollar" },
  SGD: { plural: "Singapore Dollars", singular: "Singapore Dollar" },
  HKD: { plural: "Hong Kong Dollars", singular: "Hong Kong Dollar" },
  ZAR: { plural: "South African Rand", singular: "South African Rand" },
  KES: { plural: "Kenyan Shillings", singular: "Kenyan Shilling" },
  GHS: { plural: "Ghanaian Cedis", singular: "Ghanaian Cedi" },
};

const ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** Words for 0–999. */
function belowThousand(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : "");
  return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${belowThousand(n % 100)}` : ""}`;
}

/** Indian scale: crore / lakh / thousand — the way INR amounts are written. */
function indianScaleWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return parts.join(" ");
}

/** International short scale: billion / million / thousand. */
function shortScaleWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const billion = Math.floor(n / 1_000_000_000);
  n %= 1_000_000_000;
  const million = Math.floor(n / 1_000_000);
  n %= 1_000_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (billion) parts.push(`${belowThousand(billion)} Billion`);
  if (million) parts.push(`${belowThousand(million)} Million`);
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return parts.join(" ");
}

/**
 * Document money format — international for export currencies, domestic for INR.
 * formatDocMoney(2800000, "USD") → "USD 2,800,000.00"
 * formatDocMoney(2800000, "INR") → "₹28,00,000.00"
 */
export function formatDocMoney(amount: number, currency: string): string {
  const code = (currency || "INR").trim().toUpperCase();
  if (code === "INR") {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }
  const num = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${code} ${num}`;
}

/**
 * Amount in words for a printed invoice total.
 * amountInWords(2800000, "USD")
 *   → "Two Million Eight Hundred Thousand United States Dollars Only."
 * amountInWords(2800000, "INR")
 *   → "Twenty Eight Lakh Indian Rupees Only."
 * Cents/paise are appended only when non-zero.
 */
export function amountInWords(amount: number, currency: string): string {
  const code = (currency || "INR").trim().toUpperCase();
  const safe = Number.isFinite(amount) ? Math.abs(amount) : 0;
  const whole = Math.floor(safe);
  const fraction = Math.round((safe - whole) * 100);
  const name = CURRENCY_NAMES[code];
  const currencyName = name
    ? whole === 1 && fraction === 0
      ? name.singular
      : name.plural
    : code;

  const words = code === "INR" ? indianScaleWords(whole) : shortScaleWords(whole);
  const fractionPart = fraction > 0 ? ` and ${belowThousand(fraction)} Cents` : "";
  return `${words} ${currencyName}${fractionPart} Only.`;
}
