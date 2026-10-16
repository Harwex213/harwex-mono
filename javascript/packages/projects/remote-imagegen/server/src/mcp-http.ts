import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { ImageGenerator } from "./codex-image.js";
import { log } from "./config.js";
import { registerGenerateImage } from "./generate-image-tool.js";
import type { GenerationQueue } from "./limits.js";

/**
 * MCP over Streamable HTTP, with sessions.
 *
 * Sessions are here for cancellation. A client cancels a call with a
 * `notifications/cancelled` message in a separate POST. Only the server
 * instance that runs the call can abort it. Without sessions, that POST would
 * land on a fresh instance and the Codex child would run on for minutes.
 *
 * A restart drops all sessions. The client proxy then gets 404 and opens a new one.
 */

const MAX_BODY_BYTES = 50 * 1024 * 1024;
const SESSION_IDLE_MS = 30 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

type Session = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  /** Open HTTP responses of this session. A session with an open response is never idle. */
  openResponses: number;
  lastSeen: number;
};

type McpDeps = {
  generator: ImageGenerator;
  queue: GenerationQueue;
};

class BodyTooLargeError extends Error {}

function rpcError(res: ServerResponse, status: number, code: number, message: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > MAX_BODY_BYTES) {
      reject(new BodyTooLargeError());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLargeError());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

/** The ids of the JSON-RPC requests in a POST body (a single message or a batch). */
function requestIds(body: unknown): (string | number)[] {
  const messages = Array.isArray(body) ? body : [body];
  const ids: (string | number)[] = [];
  for (const message of messages) {
    if (typeof message !== "object" || message === null || !("method" in message) || !("id" in message)) {
      continue;
    }
    const id = (message as { id: unknown }).id;
    if (typeof id === "string" || typeof id === "number") {
      ids.push(id);
    }
  }
  return ids;
}

function createMcpHandler(deps: McpDeps): { handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>; closeAll: () => void } {
  const sessions = new Map<string, Session>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (session.openResponses === 0 && now - session.lastSeen > SESSION_IDLE_MS) {
        log(`session ${id.slice(0, 8)} idle, closing`);
        void session.transport.close().catch(() => {});
      }
    }
  }, SWEEP_INTERVAL_MS);
  sweep.unref();

  function openSession(): Session {
    const server = new McpServer({ name: "remote-imagegen", version: "0.1.0" });
    registerGenerateImage(server, deps);
    const session: Session = {
      server,
      transport: new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, session);
        },
      }),
      openResponses: 0,
      lastSeen: Date.now(),
    };
    // Closing the transport (DELETE, idle sweep, shutdown) also closes the server.
    // That aborts every running tool call of the session and kills its Codex children.
    session.transport.onclose = () => {
      const id = session.transport.sessionId;
      if (id) {
        sessions.delete(id);
      }
      void server.close().catch(() => {});
    };
    return session;
  }

  function track(session: Session, res: ServerResponse, body: unknown): void {
    session.openResponses += 1;
    session.lastSeen = Date.now();
    res.on("close", () => {
      session.openResponses -= 1;
      session.lastSeen = Date.now();
      if (res.writableFinished) {
        return;
      }
      // The connection dropped before the answer went out. Nobody can receive
      // the result, so the calls of this POST are cancelled as if the client asked.
      for (const requestId of requestIds(body)) {
        session.transport.onmessage?.({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { requestId, reason: "client disconnected" },
        });
      }
    });
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: unknown;
    if (req.method === "POST") {
      try {
        body = JSON.parse((await readBody(req)).toString("utf8"));
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          rpcError(res, 413, -32000, `Request body is larger than ${MAX_BODY_BYTES / 1024 / 1024} MB.`);
          return;
        }
        rpcError(res, 400, -32700, "Parse error: the body is not valid JSON.");
        return;
      }
    }

    const sessionHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;

    let session: Session | undefined;
    if (sessionId) {
      session = sessions.get(sessionId);
      if (!session) {
        rpcError(res, 404, -32001, "Session not found.");
        return;
      }
    } else if (req.method === "POST" && isInitializeRequest(body)) {
      session = openSession();
      await session.server.connect(session.transport);
    } else {
      rpcError(res, 400, -32000, "Bad request: no valid session id.");
      return;
    }

    track(session, res, body);
    await session.transport.handleRequest(req, res, body);
  }

  function closeAll(): void {
    clearInterval(sweep);
    for (const session of sessions.values()) {
      void session.transport.close().catch(() => {});
    }
  }

  return { handle, closeAll };
}

export { createMcpHandler };
