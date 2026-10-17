import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isOpaqueOriginAssetLoad, isSameOriginRequest } from "./origin-guard.js";
import type { IncomingMessage } from "node:http";

const HOST = "localhost:4001";

const request = (headers: Record<string, string>): IncomingMessage => {
  return { headers: { host: HOST, ...headers } } as unknown as IncomingMessage;
};

describe("isSameOriginRequest", () => {
  it("accepts a request with no browser context", () => {
    assert.equal(isSameOriginRequest(request({})), true);
  });

  it("accepts the app's own origin, also through the dev proxy", () => {
    assert.equal(isSameOriginRequest(request({ origin: `http://${HOST}`, "sec-fetch-site": "same-origin" })), true);
    assert.equal(
      isSameOriginRequest({ headers: { host: "localhost:8140", origin: "http://localhost:8140" } } as unknown as IncomingMessage),
      true
    );
  });

  it("refuses a sandboxed vault page and foreign sites", () => {
    assert.equal(isSameOriginRequest(request({ origin: "null", "sec-fetch-site": "cross-site" })), false);
    assert.equal(isSameOriginRequest(request({ origin: "null" })), false);
    assert.equal(isSameOriginRequest(request({ origin: "https://example.com" })), false);
    assert.equal(isSameOriginRequest(request({ "sec-fetch-site": "cross-site" })), false);
    assert.equal(isSameOriginRequest(request({ "sec-fetch-site": "same-site", origin: "http://localhost:8140" })), false);
  });
});

describe("isOpaqueOriginAssetLoad", () => {
  const base = { origin: "null", "sec-fetch-site": "cross-site" };

  it("answers CORS for module scripts and fonts of a sandboxed page", () => {
    assert.equal(isOpaqueOriginAssetLoad(request({ ...base, "sec-fetch-dest": "script" })), true);
    assert.equal(isOpaqueOriginAssetLoad(request({ ...base, "sec-fetch-dest": "font" })), true);
  });

  it("never answers CORS for loads whose bytes a page could read", () => {
    assert.equal(isOpaqueOriginAssetLoad(request({ ...base, "sec-fetch-dest": "empty" })), false);
    assert.equal(isOpaqueOriginAssetLoad(request({ ...base, "sec-fetch-dest": "json" })), false);
    assert.equal(isOpaqueOriginAssetLoad(request({ ...base, "sec-fetch-dest": "image" })), false);
    assert.equal(isOpaqueOriginAssetLoad(request({ ...base, "sec-fetch-dest": "style" })), false);
    assert.equal(isOpaqueOriginAssetLoad(request({ origin: "https://example.com", "sec-fetch-dest": "script" })), false);
  });
});
