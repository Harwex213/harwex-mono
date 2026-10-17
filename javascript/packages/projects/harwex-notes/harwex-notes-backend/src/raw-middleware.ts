import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { RAW_URL_PREFIX, readRawFile } from "./service/raw-service.js";
import type { FsDataAccess } from "./data-access/fs-data-access.types.js";

const RAW_MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".markdown": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
};

// A vault page runs sandboxed even when it is opened outside the app's iframe: no access to
// the app's origin, no navigation of anything but itself (HTML-4).
const RAW_SANDBOX_POLICY = "sandbox allow-scripts allow-forms allow-popups allow-modals";

type TRawMiddleware = (req: IncomingMessage, res: ServerResponse) => boolean;

const sendStatus = (res: ServerResponse, status: number, message: string) => {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
};

// Answers `GET /api/raw/<vault-relative path>` with the bytes of that file. Returns false
// when the request is not for the raw route, so the caller passes it on.
const createRawMiddleware = (dataAccess: FsDataAccess): TRawMiddleware => {
  const prefix = `${RAW_URL_PREFIX}/`;

  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith(prefix)) {
      return false;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();

      return true;
    }

    const rawPath = url.pathname.slice(prefix.length);

    void readRawFile(dataAccess, rawPath).then(
      (file) => {
        if (file === null) {
          sendStatus(res, 404, "Not found");

          return;
        }

        const extension = path.extname(file.name).toLowerCase();

        res.writeHead(200, {
          "Content-Type": RAW_MIME_TYPES[extension] ?? "application/octet-stream",
          "Content-Length": String(file.bytes.byteLength),
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": RAW_SANDBOX_POLICY,
        });

        if (req.method === "HEAD") {
          res.end();

          return;
        }

        res.end(file.bytes);
      },
      (error: unknown) => {
        sendStatus(res, 500, error instanceof Error ? error.message : String(error));
      }
    );

    return true;
  };
};

export { createRawMiddleware };
export type { TRawMiddleware };
