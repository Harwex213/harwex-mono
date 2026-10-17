import type { IncomingMessage } from "node:http";

// The api has no login (APP-7), so the origin of a request is its only credential. The app
// calls the api from its own origin: the backend serves the built app, and the rspack dev
// server forwards `/api` without changing the Host header. A request from any other origin
// is refused. That includes a vault HTML page, which runs sandboxed with the opaque origin
// "null" (HTML-4), and any web site the user happens to visit.

const readHeader = (req: IncomingMessage, name: string): string | undefined => {
  const value = req.headers[name];

  return Array.isArray(value) ? value[0] : value;
};

const readUrlHost = (value: string | undefined): string | null => {
  if (value === undefined || value === "null") {
    return null;
  }

  try {
    return new URL(value).host;
  } catch {
    return null;
  }
};

// True for a request made by a page of this origin, and for a request with no browser
// context at all (curl, a test). Browsers send `Sec-Fetch-Site` and, on every cross-origin
// request, `Origin`; neither can be set by page script.
const isSameOriginRequest = (req: IncomingMessage): boolean => {
  const fetchSite = readHeader(req, "sec-fetch-site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") {
    return false;
  }

  const origin = readHeader(req, "origin");
  if (origin === undefined) {
    return true;
  }

  const originHost = readUrlHost(origin);

  return originHost !== null && originHost === readHeader(req, "host");
};

// Destinations that a vault page loads in CORS mode and cannot run without an
// `Access-Control-Allow-Origin` answer: module scripts and fonts (HTML-2, HTML-3).
const CORS_ASSET_DESTINATIONS: ReadonlySet<string> = new Set(["script", "font"]);

// A vault page runs with the opaque origin "null" and sends no referrer, so the backend
// cannot tell it apart from any other sandboxed page. The raw route therefore answers CORS
// for these two destinations only. `fetch()` (destination "empty"), JSON modules, images
// and stylesheets get no CORS answer, so no other page can read a note, a picture or a
// stylesheet from the vault as data. The cost: any sandboxed page can import a `.js` file
// of the vault as a module and see what it exports.
const isOpaqueOriginAssetLoad = (req: IncomingMessage): boolean => {
  const destination = readHeader(req, "sec-fetch-dest");

  return (
    readHeader(req, "origin") === "null" &&
    destination !== undefined &&
    CORS_ASSET_DESTINATIONS.has(destination)
  );
};

export { isOpaqueOriginAssetLoad, isSameOriginRequest };
