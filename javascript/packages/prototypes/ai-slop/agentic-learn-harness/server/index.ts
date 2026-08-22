import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AskEvent, AskRequest, Graph } from "../shared/types.ts";
import { runAsk } from "./agent.ts";
import { Store } from "./store.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const store = new Store(path.join(here, "..", ".data"));

const PORT = Number(process.env.PORT ?? 5757);
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
  });
  response.end(payload);
}

async function readBody(request: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > MAX_BODY_BYTES) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** Opens an SSE channel and returns a writer for harness events. */
function openEventStream(response: http.ServerResponse): (event: AskEvent) => void {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "access-control-allow-origin": "*",
  });
  return (event: AskEvent) => {
    if (response.writableEnded) {
      return;
    }
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}

function isAskRequest(value: unknown): value is AskRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<AskRequest>;
  return (
    typeof candidate.nodeId === "string" &&
    typeof candidate.prompt === "string" &&
    Array.isArray(candidate.images) &&
    Array.isArray(candidate.ancestors) &&
    typeof candidate.model === "string"
  );
}

async function handleAsk(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  const body = await readBody(request);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    sendJson(response, 400, { error: "Body is not valid JSON." });
    return;
  }
  if (!isAskRequest(parsed)) {
    sendJson(response, 400, { error: "Body is not a valid ask request." });
    return;
  }
  if (parsed.prompt.trim().length === 0 && parsed.images.length === 0) {
    sendJson(response, 400, { error: "A question needs text or an image." });
    return;
  }

  const emit = openEventStream(response);
  const abortController = new AbortController();
  request.on("close", () => {
    abortController.abort();
  });
  const heartbeat = setInterval(() => {
    if (!response.writableEnded) {
      response.write(": ping\n\n");
    }
  }, 15_000);

  try {
    await runAsk(parsed, store, emit, abortController.signal);
  } catch (error) {
    emit({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearInterval(heartbeat);
    response.end();
  }
}

async function handleImageUpload(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  const mediaType = (request.headers["content-type"] ?? "").split(";")[0].trim();
  if (!ALLOWED_IMAGE_TYPES.includes(mediaType)) {
    sendJson(response, 415, { error: `Unsupported image type: ${mediaType || "none"}` });
    return;
  }
  const rawName = request.headers["x-image-name"];
  const name = typeof rawName === "string" ? decodeURIComponent(rawName) : "pasted-image";
  const body = await readBody(request);
  if (body.byteLength === 0) {
    sendJson(response, 400, { error: "The upload was empty." });
    return;
  }
  const image = await store.saveImage(body, mediaType, name);
  sendJson(response, 200, image);
}

async function handleImageRead(
  id: string,
  response: http.ServerResponse,
): Promise<void> {
  const stored = await store.readImage(id);
  if (!stored) {
    sendJson(response, 404, { error: "No such image." });
    return;
  }
  response.writeHead(200, {
    "content-type": stored.mediaType,
    "content-length": stored.bytes.byteLength,
    "cache-control": "public, max-age=31536000, immutable",
    "access-control-allow-origin": "*",
  });
  response.end(stored.bytes);
}

async function handleGraphWrite(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  const body = await readBody(request);
  let parsed: Graph;
  try {
    parsed = JSON.parse(body.toString("utf8")) as Graph;
  } catch {
    sendJson(response, 400, { error: "Body is not valid JSON." });
    return;
  }
  if (parsed.version !== 1 || !Array.isArray(parsed.nodes)) {
    sendJson(response, 400, { error: "Body is not a valid graph." });
    return;
  }
  await store.writeGraph(parsed);
  sendJson(response, 200, { ok: true, nodes: parsed.nodes.length });
}

async function route(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const method = request.method ?? "GET";

  if (method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
      "access-control-allow-headers": "content-type, x-image-name",
      "access-control-max-age": "86400",
    });
    response.end();
    return;
  }

  if (method === "POST" && url.pathname === "/api/ask") {
    await handleAsk(request, response);
    return;
  }
  if (method === "POST" && url.pathname === "/api/images") {
    await handleImageUpload(request, response);
    return;
  }
  if (method === "GET" && url.pathname.startsWith("/api/images/")) {
    await handleImageRead(decodeURIComponent(url.pathname.slice("/api/images/".length)), response);
    return;
  }
  if (method === "GET" && url.pathname === "/api/graph") {
    sendJson(response, 200, await store.readGraph());
    return;
  }
  if (method === "PUT" && url.pathname === "/api/graph") {
    await handleGraphWrite(request, response);
    return;
  }
  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, images: await store.imageCount() });
    return;
  }
  sendJson(response, 404, { error: `No route for ${method} ${url.pathname}` });
}

async function main(): Promise<void> {
  await store.init();
  const server = http.createServer((request, response) => {
    route(request, response).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!response.headersSent) {
        sendJson(response, 500, { error: message });
        return;
      }
      response.end();
    });
  });
  // A long-lived SSE turn must not be cut off by the default socket timeout.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 75_000;
  server.listen(PORT, () => {
    process.stdout.write(`harness listening on http://localhost:${PORT}\n`);
  });
}

await main();
