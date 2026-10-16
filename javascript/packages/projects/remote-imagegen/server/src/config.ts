import { statSync } from "node:fs";
import path from "node:path";

type ServerConfig = {
  port: number;
  token: string;
  codexHome: string;
  model: string;
  codexPath: string | undefined;
};

const DEFAULT_PORT = 3000;
const DEFAULT_MODEL = "gpt-5.6-luna";

function log(message: string): void {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

/** Reads the env. Throws with a clear message when a required value is missing. */
function readConfig(): ServerConfig {
  const token = process.env.REMOTE_IMAGEGEN_TOKEN?.trim();
  if (!token) {
    throw new Error("REMOTE_IMAGEGEN_TOKEN is not set. The server refuses to run without a token.");
  }

  const homeValue = process.env.CODEX_HOME?.trim();
  if (!homeValue) {
    throw new Error("CODEX_HOME is not set. Point it at the folder that holds the Codex ChatGPT login.");
  }
  const codexHome = path.resolve(homeValue);
  const info = statSync(codexHome, { throwIfNoEntry: false });
  if (!info || !info.isDirectory()) {
    throw new Error(`CODEX_HOME is not a folder: ${codexHome}`);
  }

  const portValue = process.env.PORT?.trim();
  const port = portValue ? Number(portValue) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT is not a valid port number: ${portValue}`);
  }

  return {
    port,
    token,
    codexHome,
    model: process.env.CODEX_MODEL?.trim() || DEFAULT_MODEL,
    codexPath: process.env.CODEX_PATH?.trim() || undefined,
  };
}

export { log, readConfig };
export type { ServerConfig };
