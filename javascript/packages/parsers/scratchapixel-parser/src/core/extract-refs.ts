import { parse } from "node-html-parser";

/** Raw, still-unresolved refs found in one HTML document. */
type ExtractedRefs = {
  /** `<a href>` targets — candidates for further crawling. */
  links: string[];
  /** Images, stylesheets, scripts and other embedded files. */
  assets: string[];
};

/** Attributes that point at an embedded file, per tag. */
const ASSET_ATTRIBUTES: { selector: string; attribute: string }[] = [
  { selector: "img", attribute: "src" },
  { selector: "img", attribute: "data-src" },
  { selector: "source", attribute: "src" },
  { selector: "video", attribute: "src" },
  { selector: "video", attribute: "poster" },
  { selector: "audio", attribute: "src" },
  { selector: "script", attribute: "src" },
  { selector: "link", attribute: "href" },
  { selector: "embed", attribute: "src" },
  { selector: "object", attribute: "data" },
];

/** Tags whose `srcset` lists several candidate files. */
const SRCSET_SELECTORS = ["img", "source"];

// A srcset entry is "<url> <descriptor>"; the url is the first token. Entries are
// comma-separated, and `data:` urls may themselves contain commas — those are
// dropped downstream by normalizeUrl, so a sloppy split is safe here.
const parseSrcset = (value: string): string[] =>
  value
    .split(",")
    .map((entry) => entry.trim().split(/\s+/, 1)[0] ?? "")
    .filter((candidate) => candidate.length > 0);

/**
 * Collect every ref an HTML document points at, without resolving or filtering
 * them — the caller decides what is same-origin and what is worth fetching.
 */
const extractRefs = (html: string): ExtractedRefs => {
  const root = parse(html);
  const links: string[] = [];
  const assets: string[] = [];

  for (const anchor of root.querySelectorAll("a")) {
    const href = anchor.getAttribute("href");
    if (href) {
      links.push(href);
    }
  }

  for (const { selector, attribute } of ASSET_ATTRIBUTES) {
    for (const element of root.querySelectorAll(selector)) {
      const value = element.getAttribute(attribute);
      if (value) {
        assets.push(value);
      }
    }
  }

  for (const selector of SRCSET_SELECTORS) {
    for (const element of root.querySelectorAll(selector)) {
      const value = element.getAttribute("srcset");
      if (value) {
        assets.push(...parseSrcset(value));
      }
    }
  }

  return { links, assets };
};

export { extractRefs };
export type { ExtractedRefs };
