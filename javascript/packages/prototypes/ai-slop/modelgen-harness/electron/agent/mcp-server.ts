import { randomBytes } from "node:crypto";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { buildTools } from "./tools.js";
import type { RunContext } from "./tools.js";

/**
 * Codex only reaches outside tools through MCP, so the harness is an MCP
 * server: one HTTP endpoint on the loopback interface, one unguessable path
 * per run. A request on `/mcp/<token>` is answered by a fresh, stateless MCP
 * server whose tools are bound to that run's tab — its Blender, its chat
 * message, its settings. Codex is pointed at the URL through its config.
 */

const HOST = "127.0.0.1";
const PATH_PREFIX = "/mcp/";

const runs = new Map<string, RunContext>();
let server: http.Server | null = null;
let port = 0;

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function toCallResult(text: string, image: Uint8Array | undefined, isError: boolean | undefined): CallToolResult {
  const content: CallToolResult["content"] = [{ type: "text", text }];
  if (image) {
    content.push({ type: "image", data: Buffer.from(image).toString("base64"), mimeType: "image/png" });
  }
  return isError ? { content, isError: true } : { content };
}

function mcpServerFor(ctx: RunContext): McpServer {
  const mcp = new McpServer({ name: "modelgen-harness", version: "1.0.0" });
  for (const definition of buildTools(ctx)) {
    mcp.registerTool(
      definition.name,
      { description: definition.description, inputSchema: definition.schema },
      async (args: Record<string, unknown>) => {
        const result = await definition.execute(args ?? {});
        return toCallResult(result.text, result.image, result.isError);
      },
    );
  }
  return mcp;
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${HOST}`);
  if (!url.pathname.startsWith(PATH_PREFIX)) {
    response.writeHead(404).end("not found");
    return;
  }
  const token = url.pathname.slice(PATH_PREFIX.length);
  const ctx = runs.get(token);
  if (!ctx) {
    response.writeHead(404).end("no such run");
    return;
  }
  let body: unknown;
  try {
    body = await readBody(request);
  } catch {
    response.writeHead(400).end("bad json");
    return;
  }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const mcp = mcpServerFor(ctx);
  response.on("close", () => {
    void transport.close();
    void mcp.close();
  });
  await mcp.connect(transport);
  await transport.handleRequest(request, response, body);
}

/** Starts listening once. Resolves to the port. */
function startMcpServer(): Promise<number> {
  if (server) {
    return Promise.resolve(port);
  }
  return new Promise((resolve, reject) => {
    server = http.createServer((request, response) => {
      handle(request, response).catch((error: unknown) => {
        if (!response.headersSent) {
          response.writeHead(500);
        }
        response.end(error instanceof Error ? error.message : String(error));
      });
    });
    server.on("error", reject);
    server.listen(0, HOST, () => {
      const address = server?.address();
      port = typeof address === "object" && address ? address.port : 0;
      resolve(port);
    });
  });
}

/** Makes a run reachable. Returns the URL Codex is given and a way to take it down. */
function registerRun(ctx: RunContext): { url: string; release(): void } {
  const token = randomBytes(18).toString("base64url");
  runs.set(token, ctx);
  return {
    url: `http://${HOST}:${port}${PATH_PREFIX}${token}`,
    release() {
      runs.delete(token);
    },
  };
}

export { registerRun, startMcpServer };
