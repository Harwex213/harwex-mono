import { resolve, sep } from "node:path";

import type { ResourceKind } from "../model/types.js";

/** The site the crawler is built for. */
const SITE_ORIGIN = "https://www.scratchapixel.com";

/** Entry point of a full-site crawl. */
const SITE_START_URL = `${SITE_ORIGIN}/index.html`;

/** Extensions we treat as "a page", i.e. HTML worth parsing for more links. */
const PAGE_EXTENSIONS = new Set([".html", ".htm"]);

/** Ref schemes that never point at a file we can mirror. */
const IGNORED_SCHEMES = new Set(["data:", "javascript:", "mailto:", "tel:", "blob:", "about:"]);

// The site emits hrefs like `…/introduction-to-ray-tracing//how-does-it-work.html`.
// The server collapses the repeat, so we must too, or the same page is saved twice.
const collapseSlashes = (pathname: string): string => pathname.replace(/\/{2,}/g, "/");

/** Lowercased extension of the last path segment, or "" when it has none. */
const extensionOf = (pathname: string): string => {
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex <= 0) {
    return "";
  }
  return lastSegment.slice(dotIndex).toLowerCase();
};

/**
 * Resolve a raw href/src against `base` and strip everything that does not
 * change which file is served: the fragment, the query string, repeated slashes.
 * Returns null for refs that are not fetchable http(s) urls.
 */
const normalizeUrl = (raw: string, base: string): URL | null => {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const scheme = trimmed.slice(0, trimmed.indexOf(":") + 1).toLowerCase();
  if (IGNORED_SCHEMES.has(scheme)) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed, base);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  url.hash = "";
  url.search = "";
  url.pathname = collapseSlashes(url.pathname);
  return url;
};

/**
 * Canonicalize a page url so the two spellings the site uses for one chapter —
 * `…/how-does-it-work` and `…/how-does-it-work.html` — collapse to one entry.
 * A directory url becomes its index page.
 */
const toPageUrl = (url: URL): URL => {
  const pageUrl = new URL(url.toString());

  if (pageUrl.pathname.endsWith("/")) {
    pageUrl.pathname = `${pageUrl.pathname}index.html`;
    return pageUrl;
  }

  if (extensionOf(pageUrl.pathname) === "") {
    pageUrl.pathname = `${pageUrl.pathname}.html`;
  }

  return pageUrl;
};

/** A url with no extension, or an HTML one, is a page; anything else is an asset. */
const classifyUrl = (url: URL): ResourceKind => {
  const extension = extensionOf(url.pathname);
  if (extension === "" || PAGE_EXTENSIONS.has(extension)) {
    return "page";
  }
  return "asset";
};

const isSameOrigin = (url: URL, origin: string): boolean => url.origin === origin;

const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

// Strip characters that are illegal in a path segment on some platforms, and
// neutralize the ones that would let a crafted url escape the output directory.
const sanitizeSegment = (segment: string): string => {
  const decoded = decodeSegment(segment).replace(/[\0<>:"|?*\\]/g, "_");
  if (decoded === "." || decoded === "..") {
    return "_";
  }
  return decoded;
};

/**
 * Map a url onto a file inside `outDir`, mirroring the site's path layout so the
 * saved copy browses like the original when served from `outDir`.
 */
const urlToLocalPath = (url: URL, outDir: string): string => {
  const segments = url.pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(sanitizeSegment);

  const outDirRoot = resolve(outDir);
  const target = segments.length > 0 ? resolve(outDirRoot, ...segments) : resolve(outDirRoot, "index.html");

  if (target !== outDirRoot && !target.startsWith(`${outDirRoot}${sep}`)) {
    throw new Error(`url ${url.toString()} maps outside the output directory`);
  }

  return target;
};

export {
  SITE_ORIGIN,
  SITE_START_URL,
  normalizeUrl,
  toPageUrl,
  classifyUrl,
  isSameOrigin,
  urlToLocalPath,
  extensionOf,
};
