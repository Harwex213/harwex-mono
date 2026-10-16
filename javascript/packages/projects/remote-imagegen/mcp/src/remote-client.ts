import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const DEFAULT_URL = "https://imagegen.harwexworld.com/mcp";

// Generation takes 30-300 s. The server sends progress every 10 s, in its queue
// and while it works, so each progress event resets the idle timeout.
// The total cap stops a stuck call. It covers the server's 5 min run limit plus
// a full queue: 20 waiting jobs over 5 slots can wait about 20 min.
const IDLE_TIMEOUT_MS = 360_000;
const MAX_TOTAL_TIMEOUT_MS = 30 * 60_000;

type RemoteImage = {
  data: string;
  mimeType: string;
};

type RemoteArgs = {
  prompt: string;
  images?: RemoteImage[];
  size?: string;
};

type CallOptions = {
  signal: AbortSignal;
  onprogress?: RequestOptions["onprogress"];
};

type RemoteConfig = {
  url: URL;
  token: string;
};

function log(message: string): void {
  // stdout belongs to the MCP transport. Logs go to stderr.
  process.stderr.write(`[remote-imagegen-mcp] ${message}\n`);
}

function readConfig(): RemoteConfig {
  const token = process.env.REMOTE_IMAGEGEN_TOKEN?.trim();
  if (!token) {
    throw new Error("REMOTE_IMAGEGEN_TOKEN is not set. Add it to the env of this MCP server in your client config.");
  }
  const url = new URL(process.env.REMOTE_IMAGEGEN_URL?.trim() || DEFAULT_URL);
  return { url, token };
}

// One connection is shared by all calls. A failed connect clears it,
// so the next call starts a fresh one.
let connecting: Promise<Client> | undefined;
let connected: Client | undefined;

function getClient(): Promise<Client> {
  if (!connecting) {
    const attempt = connect();
    connecting = attempt;
    attempt.catch(() => {
      if (connecting === attempt) {
        connecting = undefined;
      }
    });
  }
  return connecting;
}

async function connect(): Promise<Client> {
  const config = readConfig();
  const transport = new StreamableHTTPClientTransport(config.url, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    },
  });
  const client = new Client({ name: "remote-imagegen-mcp", version: "0.1.0" });
  client.onclose = () => {
    dropClient(client);
  };
  await client.connect(transport);
  connected = client;
  log(`connected to ${config.url.href}`);
  return client;
}

// Forget a broken client. Only the current client resets the cache,
// so a late close event from an old client cannot drop a newer one.
function dropClient(client: Client): void {
  if (connected !== client) {
    return;
  }
  connected = undefined;
  connecting = undefined;
  client.close().catch(() => {});
}

// These errors mean the server never started the work: the session expired
// after a server restart, or the network failed before the request went out.
// A retry with a new session is safe and does not run a generation twice.
function isStaleConnection(error: unknown): boolean {
  if (error instanceof StreamableHTTPError) {
    return error.code === 404 || error.code === 400;
  }
  return error instanceof TypeError;
}

async function callRemote(args: RemoteArgs, options: CallOptions): Promise<CallToolResult> {
  const requestOptions: RequestOptions = {
    signal: options.signal,
    timeout: IDLE_TIMEOUT_MS,
    resetTimeoutOnProgress: true,
    maxTotalTimeout: MAX_TOTAL_TIMEOUT_MS,
    // The SDK attaches a progressToken only when onprogress is set.
    // Without the token the server cannot send progress, and the idle timeout cannot reset.
    onprogress: options.onprogress ?? (() => {}),
  };
  for (let attempt = 1; ; attempt += 1) {
    const client = await getClient();
    try {
      const result = await client.callTool({ name: "generate_image", arguments: args }, undefined, requestOptions);
      return result as CallToolResult;
    } catch (error) {
      if (attempt >= 2 || options.signal.aborted || !isStaleConnection(error)) {
        throw error;
      }
      log(`connection looks stale (${String(error)}), reconnecting`);
      dropClient(client);
    }
  }
}

function checkConfig(): string | undefined {
  try {
    readConfig();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function closeRemote(): Promise<void> {
  const client = connected;
  connected = undefined;
  connecting = undefined;
  if (client) {
    await client.close().catch(() => {});
  }
}

export { callRemote, checkConfig, closeRemote, log };
export type { RemoteArgs, RemoteImage };
