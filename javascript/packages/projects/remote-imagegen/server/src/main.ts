import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { ImageGenerator } from "./codex-image.js";
import { log, readConfig } from "./config.js";
import { GenerationQueue, StartLock } from "./limits.js";
import { createMcpHandler } from "./mcp-http.js";

const MAX_RUNNING = 5;
const MAX_WAITING = 20;
const START_LOCK_TIMEOUT_MS = 20_000;

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

/** Hashing first gives both sides the same length, which timingSafeEqual needs. */
function sameSecret(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

function isAuthorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || !match[1]) {
    return false;
  }
  return sameSecret(match[1].trim(), token);
}

async function main(): Promise<void> {
  const config = readConfig();
  const queue = new GenerationQueue(MAX_RUNNING, MAX_WAITING);
  const generator = new ImageGenerator(config, new StartLock(START_LOCK_TIMEOUT_MS));

  const mcp = createMcpHandler({ generator, queue });

  const httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    if (url.pathname !== "/mcp") {
      sendJson(res, 404, { error: "not found" });
      return;
    }

    if (!isAuthorized(req, config.token)) {
      sendJson(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
      return;
    }

    mcp.handle(req, res).catch((error: unknown) => {
      log(`mcp request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (res.headersSent) {
        res.end();
        return;
      }
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error." }, id: null }));
    });
  });

  // Generations stream for minutes. The default request timeout would cut them off.
  httpServer.requestTimeout = 0;
  httpServer.headersTimeout = 60_000;

  const shutdown = (signal: string): void => {
    log(`${signal}: shutting down`);
    httpServer.close();
    // Closing the sessions aborts running generations and kills their Codex children.
    mcp.closeAll();
    // Give the Codex children a moment to die before the process exits.
    setTimeout(() => {
      process.exit(0);
    }, 1000).unref();
  };
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });

  httpServer.listen(config.port, () => {
    const address = httpServer.address();
    const port = typeof address === "object" && address ? address.port : config.port;
    log(`remote-imagegen listening on :${port} (model ${config.model}, CODEX_HOME ${config.codexHome})`);
    // The server still starts, so the login can be done later with `codex login --device-auth` inside the container.
    if (!existsSync(path.join(config.codexHome, "auth.json"))) {
      log("warning: CODEX_HOME has no auth.json. Generations fail until Codex is logged in.");
    }
  });
}

main().catch((error: unknown) => {
  log(`fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
