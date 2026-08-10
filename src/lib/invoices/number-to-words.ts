// "Invoice Declared Value: USD One Hundred Thirty Eight Dollars and Sixty
// Cents Only" — the sample invoice (NL1712627.pdf) prints the declared
// value in words at the bottom, standard practice on export customs
// invoices. No existing number-to-words helper anywhere in this codebase
// (checked), so this is a small standalone implementation — English only,
// dollars-and-cents shaped (this app's invoices are always USD-denominated
// per the sample's "USD" column headers), good up to 999,999,999.99 which
// is far beyond any realistic single shipment's value.

const ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function threeDigitsToWords(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(ONES[Math.floor(n / 100)], "Hundred");
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)]);
    n %= 10;
    if (n > 0) parts.push(ONES[n]);
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
}

function integerToWords(n: number): string {
  if (n === 0) return "Zero";
  const segments: Array<[number, string]> = [
    [1_000_000_000, "Billion"],
    [1_000_000, "Million"],
    [1_000, "Thousand"],
    [1, ""],
  ];
  const parts: string[] = [];
  let remaining = n;
  for (const [scale, label] of segments) {
    const count = Math.floor(remaining / scale);
    if (count > 0) {
      parts.push(threeDigitsToWords(count));
      if (label) parts.push(label);
      remaining %= scale;
    }
  }
  return parts.join(" ");
}

/**
 * amountInWords(138.60, "USD") -> "USD One Hundred Thirty Eight Dollars
 * and Sixty Cents Only"
 */
export function amountInWords(amount: number, currencyCode: string = "USD"): string {
  const currencyName = currencyCode === "USD" ? "Dollars" : currencyCode;
  const rounded = Math.round(Math.abs(amount) * 100) / 100;
  const wholePart = Math.floor(rounded);
  const centsPart = Math.round((rounded - wholePart) * 100);

  const wholeWords = `${integerToWords(wholePart)} ${currencyName}`;
  if (centsPart === 0) {
    return `${currencyCode} ${wholeWords} Only`;
  }
  const centsWords = `${integerToWords(centsPart)} Cents`;
  return `${currencyCode} ${wholeWords} and ${centsWords} Only`;
}
