import type { IncomingMessage, ServerResponse } from "node:http";

// The thin layer between node:http and the routes, so the routes read as lobby
// operations instead of stream handling. No framework: the whole API is six
// endpoints, and a dependency here would be the only one in the package.
const JSON_TYPE = { "content-type": "application/json" };
// A body this small can be buffered; nothing posted here is a file.
const MAX_BODY = 4096;

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > MAX_BODY) {
      throw new Error("body too large");
    }
  }
  if (!body) {
    return {};
  }
  const parsed: unknown = JSON.parse(body);
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, JSON_TYPE);
  response.end(JSON.stringify(body));
}

// A field is either a non-empty string or a 400 — every route here needs the same
// check, and letting `undefined` through turns into a confusing 401 further down.
function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || !value) {
    throw new Error(`${field} is required`);
  }
  return value;
}

export { readJson, requireString, sendJson };
