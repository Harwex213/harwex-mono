import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAGNIFIC_URL = "https://mcp.magnific.com";
const CONFIG_FILE = "harness.config.json";

interface HttpMcpServer {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

interface HarnessConfig {
  /** Overrides the Magnific endpoint. Handy for a proxy or a stub during a demo. */
  magnificUrl?: string;
  /** Sent with every Magnific request. Magnific itself signs in through OAuth and needs none. */
  magnificHeaders?: Record<string, string>;
  /** Model the agent runs on. Left out, the Claude Code default is used. */
  agentModel?: string;
}

async function readConfig(dir: string): Promise<HarnessConfig> {
  try {
    const raw = await readFile(path.join(dir, CONFIG_FILE), "utf8");
    return JSON.parse(raw) as HarnessConfig;
  } catch {
    return {};
  }
}

/**
 * The Magnific server the image runs talk to. The working directory wins over
 * the environment, and the environment over the published endpoint.
 */
async function magnificServer(dir: string): Promise<Record<string, HttpMcpServer>> {
  const config = await readConfig(dir);
  const url = config.magnificUrl ?? process.env.MAGNIFIC_MCP_URL ?? DEFAULT_MAGNIFIC_URL;
  const server: HttpMcpServer = { type: "http", url };
  if (config.magnificHeaders) {
    server.headers = config.magnificHeaders;
  }
  return { magnific: server };
}

export type { HarnessConfig };
export { DEFAULT_MAGNIFIC_URL, magnificServer, readConfig };
