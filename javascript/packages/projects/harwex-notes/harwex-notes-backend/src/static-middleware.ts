import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

type TStaticMiddlewareOptions = {
  /** Directory with the built frontend. */
  rootDir: string;
  /** Requests under this prefix are passed to `next()` untouched. */
  apiPrefix: string;
};

type TMiddleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

const resolveFilePath = async (rootDir: string, urlPath: string): Promise<string> => {
  const decoded = decodeURIComponent(urlPath);
  const candidate = path.normalize(path.join(rootDir, decoded));

  // Reject anything that escapes the static directory (`..` segments).
  if (candidate !== rootDir && !candidate.startsWith(rootDir + path.sep)) {
    return path.join(rootDir, "index.html");
  }

  try {
    const info = await stat(candidate);
    if (info.isFile()) {
      return candidate;
    }
  } catch {
    // Not a file: fall through to the SPA entry.
  }

  // SPA fallback: unknown routes render the app shell.
  return path.join(rootDir, "index.html");
};

const sendFile = (res: ServerResponse, filePath: string): void => {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  const isHashedAsset = /\.[0-9a-f]{8,}\./i.test(path.basename(filePath));

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", isHashedAsset ? "public, max-age=31536000, immutable" : "no-cache");

  const stream = createReadStream(filePath);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(500);
    }
    res.end();
  });
  stream.pipe(res);
};

const createStaticMiddleware = (options: TStaticMiddlewareOptions): TMiddleware => {
  const rootDir = path.resolve(options.rootDir);
  const apiPrefix = options.apiPrefix.endsWith("/") ? options.apiPrefix : options.apiPrefix + "/";

  return (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === apiPrefix.slice(0, -1) || url.pathname.startsWith(apiPrefix)) {
      next();
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }

    void resolveFilePath(rootDir, url.pathname).then(
      (filePath) => {
        sendFile(res, filePath);
      },
      () => {
        res.writeHead(500);
        res.end();
      }
    );
  };
};

export { createStaticMiddleware };
export type { TStaticMiddlewareOptions };
