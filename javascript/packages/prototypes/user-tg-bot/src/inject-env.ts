import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const ENV_FILE = ".env.local";

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      api_id: string;
      api_hash: string;
      session_string: string;
    }
  }
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readRequired(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${ENV_FILE} is missing "${name}"`);
  }
  return value;
}

/**
 * Loads `<package root>/.env.local` into `process.env` and returns the values
 * the bot needs. Throws when the file or one of the keys is missing.
 */
function injectEnv() {
  const envPath = resolve(packageRoot, ENV_FILE);
  if (!existsSync(envPath)) {
    throw new Error(`${envPath} not found: copy the api_id/api_hash from https://my.telegram.org into it`);
  }

  process.loadEnvFile(envPath);

  const rawApiId = readRequired("api_id");
  const apiId = Number(rawApiId);
  if (!Number.isInteger(apiId)) {
    throw new Error(`${ENV_FILE} has a non-numeric "api_id": ${rawApiId}`);
  }
}

injectEnv();