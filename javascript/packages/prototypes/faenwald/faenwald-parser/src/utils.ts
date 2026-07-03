// Collapse runs of whitespace and trim — VK markup is full of newlines/indentation.
export const cleanText = (text: string): string => text.replace(/\s+/g, " ").trim();

// Resolve a possibly-relative VK url against the site origin.
export const normalizeUrl = (url: string, base = "https://vk.com"): string => {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  try {
    return new URL(trimmed, base).toString();
  } catch {
    return trimmed;
  }
};

// VK renders dates with the page locale. The Faenwald fixture is German,
// e.g. "26. Dez. 2025". Best-effort parse of the "DD. Mon. YYYY" shape.
const GERMAN_MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  "mär": 2,
  mar: 2,
  apr: 3,
  mai: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  okt: 9,
  nov: 10,
  dez: 11,
};

export const parseVkDate = (raw: string): Date | null => {
  const match = raw.match(/(\d{1,2})\.\s*([\p{L}]+)\.?\s*(\d{4})/u);
  if (!match) return null;

  const [, dayStr, monthStr, yearStr] = match;
  if (!dayStr || !monthStr || !yearStr) return null;

  const month = GERMAN_MONTHS[monthStr.toLowerCase().slice(0, 3)];
  if (month === undefined) return null;

  const date = new Date(Date.UTC(Number(yearStr), month, Number(dayStr)));
  return Number.isNaN(date.getTime()) ? null : date;
};

// Decode the handful of HTML entities VK leaves inside attribute JSON.
export const decodeEntities = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
