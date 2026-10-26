// Number formats of the country sheet. The game texts are Russian, so the sheet
// uses Russian digit grouping and a decimal comma.

const LOCALE = "ru-RU";

function formatAmount(value: number): string {
  return Math.round(value).toLocaleString(LOCALE);
}

// One decimal, with an explicit sign: "+3,4 %", "−0,5 %", "0,0 %".
function formatGrowth(value: number): string {
  const digits = Math.abs(value).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (value > 0) {
    return "+" + digits + " %";
  }
  if (value < 0) {
    return "−" + digits + " %";
  }
  return digits + " %";
}

function formatPercent(value: number): string {
  return value.toLocaleString(LOCALE, { maximumFractionDigits: 1 }) + " %";
}

// A signed whole number: "+40", "−25", "0".
function formatBalance(value: number): string {
  const digits = Math.abs(Math.round(value)).toLocaleString(LOCALE);
  if (value > 0) {
    return "+" + digits;
  }
  if (value < 0) {
    return "−" + digits;
  }
  return digits;
}

// "up", "down" or "flat", for the colour of a signed value.
function trendOf(value: number): "up" | "down" | "flat" {
  if (value > 0) {
    return "up";
  }
  if (value < 0) {
    return "down";
  }
  return "flat";
}

export {
  formatAmount,
  formatBalance,
  formatGrowth,
  formatPercent,
  trendOf,
};
