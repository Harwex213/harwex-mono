import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { shell } from "electron";
import type { CodexLogin, Settings } from "../shared/types.js";
import { readCodexAuth, writeCodexAuth } from "./db.js";

/**
 * The ChatGPT login of the image tool. The tool runs Codex on the user's
 * ChatGPT account, not on an API key. The login is the `auth.json` that
 * `codex login` writes, and the app keeps that file in its SQLite database.
 *
 * The app gets the file in one of two ways. It runs `codex login` itself,
 * with a temporary Codex home, and takes the file the CLI writes there. Or it
 * takes over the login the user's own Codex CLI already holds.
 */

const LOGIN_TIMEOUT_MS = 10 * 60_000;

let pending: Promise<CodexLogin> | null = null;

/** The user's own Codex home, where `codex login` normally writes. */
function userCodexHome(): string {
  return process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
}

/** The email of a ChatGPT `auth.json`, or null when the file is not a ChatGPT login. */
function emailOf(json: string): string | null {
  let auth: { auth_mode?: unknown; tokens?: { id_token?: unknown; refresh_token?: unknown } };
  try {
    auth = JSON.parse(json) as typeof auth;
  } catch {
    return null;
  }
  const idToken = auth.tokens?.id_token;
  if (auth.auth_mode !== "chatgpt" || typeof idToken !== "string" || typeof auth.tokens?.refresh_token !== "string") {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as {
      email?: unknown;
    };
    return typeof payload.email === "string" ? payload.email : "";
  } catch {
    return "";
  }
}

async function userAuth(): Promise<string | null> {
  try {
    const json = await readFile(path.join(userCodexHome(), "auth.json"), "utf8");
    return emailOf(json) === null ? null : json;
  } catch {
    return null;
  }
}

async function codexLoginStatus(): Promise<CodexLogin> {
  const stored = readCodexAuth();
  const email = stored === null ? null : emailOf(stored);
  return {
    signedIn: email !== null,
    email: email ?? "",
    canImport: (await userAuth()) !== null,
  };
}

/** Takes over the login of the user's own Codex CLI. */
async function importCodexLogin(): Promise<CodexLogin> {
  const json = await userAuth();
  if (json === null) {
    throw new Error(`${path.join(userCodexHome(), "auth.json")} holds no ChatGPT login.`);
  }
  writeCodexAuth(json);
  return await codexLoginStatus();
}

/**
 * Runs `codex login` in a temporary Codex home. The CLI opens the ChatGPT
 * sign-in page in the browser and writes `auth.json` when the user is done.
 * The app opens the printed URL too, in case the CLI could not.
 */
function loginWithChatGpt(settings: Settings): Promise<CodexLogin> {
  if (pending) {
    return pending;
  }
  pending = (async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "assets-harness-login-"));
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(settings.codexPath || "codex", ["login"], {
          env: { ...process.env, CODEX_HOME: home },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        let opened = false;
        const onData = (chunk: Buffer) => {
          output += chunk.toString("utf8");
          const url = /https:\/\/auth\.openai\.com\/\S+/.exec(output)?.[0];
          if (url && !opened) {
            opened = true;
            void shell.openExternal(url);
          }
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("The ChatGPT sign-in took too long."));
        }, LOGIN_TIMEOUT_MS);
        child.on("error", (error) => {
          clearTimeout(timer);
          reject(new Error(`Could not start codex: ${error.message}. Set the codex executable in the settings.`));
        });
        child.on("exit", (code) => {
          clearTimeout(timer);
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`codex login ended with code ${code}. ${output.trim().slice(-300)}`));
          }
        });
      });
      const json = await readFile(path.join(home, "auth.json"), "utf8");
      if (emailOf(json) === null) {
        throw new Error("codex login wrote no ChatGPT login.");
      }
      writeCodexAuth(json);
      return await codexLoginStatus();
    } finally {
      await rm(home, { recursive: true, force: true });
      pending = null;
    }
  })();
  return pending;
}

async function logoutCodex(): Promise<CodexLogin> {
  writeCodexAuth(null);
  return await codexLoginStatus();
}

export { codexLoginStatus, importCodexLogin, loginWithChatGpt, logoutCodex };
