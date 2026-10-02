import { signal } from "@preact/signals-react";
import type { CodexLogin } from "../../shared/types.js";
import { harness } from "./bridge.js";
import { setNotice } from "./graph-state.js";

/**
 * The ChatGPT login the image runs use. The startup prompt shows while nobody
 * is signed in. Null until the main process has answered.
 */
const codexLogin = signal<CodexLogin | null>(null);
const codexLoginBusy = signal(false);

async function loadCodexLogin(): Promise<void> {
  try {
    codexLogin.value = await harness.codexLogin.status();
  } catch (error) {
    setNotice(error instanceof Error ? error.message : String(error));
  }
}

/** Runs one step of the login: `codex login`, the takeover of the CLI's login, or a logout. */
async function changeCodexLogin(step: "login" | "importCurrent" | "logout"): Promise<void> {
  codexLoginBusy.value = true;
  try {
    codexLogin.value = await harness.codexLogin[step]();
  } catch (error) {
    setNotice(error instanceof Error ? error.message : String(error));
  } finally {
    codexLoginBusy.value = false;
  }
}

export { changeCodexLogin, codexLogin, codexLoginBusy, loadCodexLogin };
