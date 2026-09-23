import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { Codex } from "@openai/codex-sdk";
import type { ThreadEvent, ThreadItem, ThreadOptions, UserInput } from "@openai/codex-sdk";
import type { AgentDriver, TurnImage, TurnReport, TurnRequest } from "./driver.js";
import { promptText, shorten, summariseCode } from "./driver.js";

/**
 * The Codex driver. Codex runs through the Codex SDK, which drives the `codex`
 * CLI with the ChatGPT account it is signed into, so no API key is involved.
 * One tab is one Codex thread, resumed on the next message.
 */

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/**
 * Codex names an exhausted ChatGPT quota only in the text of its error: both
 * the 5-hour and the weekly window end in "You've hit your usage limit …" with
 * the reset time. Say so up front, so the run does not read as a network fault.
 */
function describeFailure(message: string): string {
  if (/usage limit/i.test(message)) {
    return `Codex usage limit reached. The ChatGPT plan's quota is used up for now. ${message}`;
  }
  return message;
}

/** The user's own Codex home: the login and the config live there. */
function userCodexHome(): string {
  return process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
}

/** The Codex home runs use: the app's own, so the user's global AGENTS.md stays out. */
function codexHome(): string {
  return path.join(app.getPath("userData"), "codex-home");
}

/**
 * Codex always reads `$CODEX_HOME/AGENTS.md`, and there is no switch to skip
 * it. So a run gets its own home: the user's `auth.json` linked in (the login
 * is shared, token refreshes land in the same file), the user's `config.toml`
 * copied in (model and preferences follow), and no AGENTS.md. Sessions and
 * generated images of harness runs live there too.
 */
async function prepareCodexHome(): Promise<string> {
  const home = codexHome();
  const user = userCodexHome();
  await mkdir(home, { recursive: true });
  const auth = path.join(home, "auth.json");
  try {
    await lstat(auth);
  } catch {
    try {
      await stat(path.join(user, "auth.json"));
    } catch {
      throw new Error(`Codex is not signed in: ${path.join(user, "auth.json")} is missing. Run \`codex login\` once.`);
    }
    await symlink(path.join(user, "auth.json"), auth);
  }
  try {
    await copyFile(path.join(user, "config.toml"), path.join(home, "config.toml"));
  } catch {
    // No user config: Codex defaults apply.
  }
  return home;
}

/**
 * The MCP servers the user's own Codex config declares. They are switched off
 * for a harness run: a second Blender server pointed at another Blender would
 * only confuse the agent about which scene it is editing.
 */
async function userMcpServerNames(): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(path.join(userCodexHome(), "config.toml"), "utf8");
  } catch {
    return [];
  }
  const names = new Set<string>();
  for (const match of raw.matchAll(/^\s*\[mcp_servers\.("([^"]+)"|([A-Za-z0-9_-]+))(\.[^\]]*)?\]/gm)) {
    const name = match[2] ?? match[3];
    if (name && name !== "modelgen") {
      names.add(name);
    }
  }
  return [...names];
}

/**
 * The first message of a thread, with the run's instructions at its head.
 *
 * Codex has no parameter for a system prompt: `ThreadOptions` carries the
 * model, the sandbox and the directory, and nothing else. What it does read is
 * an `AGENTS.md`, and this app writes none — an instruction file would sit in
 * a directory the agent itself works in, where it can be read as something to
 * edit, and it would be one more thing of the app's living on disk.
 *
 * So the instructions open the conversation instead. A thread keeps them for
 * as long as it lives, which is as long as the tab's conversation, and a
 * resumed thread already holds them — only a thread that starts here is given
 * the block.
 */
function openingMessage(request: TurnRequest): string {
  return [
    "<instructions>",
    request.instructions,
    "</instructions>",
    "",
    "Everything above is how this whole conversation works, not a task. The task is below.",
    "",
    promptText(request),
  ].join("\n");
}

/** The one line a tool call gets in the progress log. */
function summariseTool(tool: string, rawArguments: unknown): string {
  const name = tool.replace(/^.*__/, "");
  const args = typeof rawArguments === "object" && rawArguments !== null ? (rawArguments as Record<string, unknown>) : {};
  const pick = (key: string): string => (typeof args[key] === "string" ? (args[key] as string) : "");
  let detail = "";
  if (name.startsWith("execute_blender_code")) {
    detail = summariseCode(pick("code"));
  } else {
    detail = pick("name") || pick("query") || pick("identifier") || pick("output_path") || pick("blend_file");
  }
  detail = shorten(detail, 96);
  return detail.length > 0 ? `${name} — ${detail}` : name;
}

/**
 * Codex takes a picture as a path and nothing else, so the pictures of this
 * turn are written to a directory of their own under the OS temp dir and
 * deleted when the turn ends. The CLI reads them on its way into the request;
 * nothing of the user's lands next to the model or outlives the turn.
 */
async function stageImages(images: TurnImage[]): Promise<{ paths: string[]; release: () => Promise<void> }> {
  if (images.length === 0) {
    return { paths: [], release: () => Promise.resolve() };
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "modelgen-turn-"));
  const paths: string[] = [];
  for (const [index, image] of images.entries()) {
    // The bytes are PNG whatever the picture was called on the way in.
    const stem = path.basename(image.name, path.extname(image.name)) || "picture";
    const file = path.join(dir, `${index}-${stem}.png`);
    await writeFile(file, image.bytes);
    paths.push(file);
  }
  return {
    paths,
    release: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Pictures Codex's built-in image tool produced since the turn began. */
async function newGeneratedImages(since: number): Promise<string[]> {
  const root = path.join(codexHome(), "generated_images");
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 3) {
          await walk(file, depth + 1);
        }
        continue;
      }
      if (!IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      try {
        const info = await stat(file);
        if (info.mtimeMs >= since - 1000) {
          found.push(file);
        }
      } catch {
        // Gone between listing and stat.
      }
    }
  };
  await walk(root, 0);
  return found.sort();
}

const mark = (status: string): string => (status === "completed" ? " ✓" : status === "failed" ? " ✗" : "");

/** Turns one Codex event into what the progress log shows. */
function report(event: ThreadEvent, out: TurnReport, state: { failedWith: string; completed: boolean; lastError: string }): void {
  if (event.type === "thread.started") {
    out.session(event.thread_id);
    return;
  }
  if (event.type === "turn.failed") {
    state.failedWith = describeFailure(event.error.message);
    return;
  }
  if (event.type === "turn.completed") {
    state.completed = true;
    // `cached_input_tokens` is the cached slice of `input_tokens`, not a total
    // beside it, so the fresh input is what is left when it is taken out.
    const usage = event.usage;
    out.tokens({
      fresh: Math.max(usage.input_tokens - usage.cached_input_tokens, 0) + usage.output_tokens,
      cached: usage.cached_input_tokens,
    });
    return;
  }
  if (event.type === "error") {
    state.lastError = event.message;
    out.step(`error:${event.message}`, `✗ ${shorten(event.message, 300)}`);
    return;
  }
  if (event.type !== "item.started" && event.type !== "item.updated" && event.type !== "item.completed") {
    return;
  }
  const item: ThreadItem = event.item;
  if (item.type === "mcp_tool_call") {
    // The SDK types say `error?`, the wire says `"error": null`; both mean no error.
    const failed =
      item.status === "failed" ||
      item.error != null ||
      item.result?.content.some((block) => block.type === "text" && /^\s*\{\s*"status"\s*:\s*"error"/.test(block.text)) === true;
    out.step(item.id, `▸ ${summariseTool(item.tool, item.arguments)}${item.status === "in_progress" ? "" : failed ? " ✗" : " ✓"}`);
    return;
  }
  if (item.type === "command_execution") {
    out.step(item.id, `▸ $ ${shorten(item.command, 96)}${mark(item.status)}`);
    return;
  }
  if (item.type === "web_search") {
    out.step(item.id, `▸ web search — ${shorten(item.query, 96)}`);
    return;
  }
  if (item.type === "file_change") {
    out.step(item.id, `▸ file change — ${item.changes.map((change) => path.basename(change.path)).join(", ")}${mark(item.status)}`);
    return;
  }
  if (item.type === "reasoning") {
    if (item.text.trim().length > 0) {
      out.summary(shorten(item.text, 240));
    }
    return;
  }
  if (item.type === "agent_message") {
    if (item.text.trim().length > 0) {
      out.summary(shorten(item.text, 240));
      if (event.type === "item.completed") {
        out.final(item.text.trim());
      }
    }
    return;
  }
  if (item.type === "error") {
    out.step(item.id, `✗ ${shorten(item.message, 300)}`);
  }
}

async function run(request: TurnRequest, out: TurnReport): Promise<void> {
  // The working directory is the agent's own scratch space. Nothing is put in
  // it here: the instructions ride the first message, not an AGENTS.md.
  await mkdir(request.workDir, { recursive: true });

  const home = await prepareCodexHome();
  const env: Record<string, string> = { CODEX_HOME: home };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "CODEX_HOME") {
      env[key] = value;
    }
  }
  const otherServers = Object.fromEntries((await userMcpServerNames()).map((name) => [name, { enabled: false }]));
  const codex = new Codex({
    ...(request.settings.codexPath ? { codexPathOverride: request.settings.codexPath } : {}),
    env,
    config: {
      // Codex looks for an AGENTS.md in the working directory and above it on
      // its way up. A run's instructions come from the harness, so it is told
      // to read none: no file on disk shapes what the agent is here.
      project_doc_max_bytes: 0,
      mcp_servers: {
        ...otherServers,
        modelgen: {
          url: request.mcpUrl,
          startup_timeout_sec: 30,
          tool_timeout_sec: 600,
          // The harness's tools are the point of the run; asking is not an option in a headless turn.
          default_tools_approval_mode: "approve",
        },
      },
    },
  });
  const options: ThreadOptions = {
    workingDirectory: request.workDir,
    skipGitRepoCheck: true,
    // The agent fetches references and materials off the web, so its sandbox
    // reaches the network and may write — into the working directory only.
    sandboxMode: "workspace-write",
    networkAccessEnabled: true,
    approvalPolicy: "never",
    webSearchMode: "live",
    webSearchEnabled: true,
    // The model and the effort belong to the tab, next to its composer.
    ...(request.tab.agentModel ? { model: request.tab.agentModel } : {}),
    ...(request.tab.reasoningEffort
      ? { modelReasoningEffort: request.tab.reasoningEffort as ThreadOptions["modelReasoningEffort"] }
      : {}),
  };
  let thread = request.sessionId ? codex.resumeThread(request.sessionId, options) : codex.startThread(options);

  const staged = await stageImages(request.images);
  const pictures = staged.paths.map((file): UserInput => ({ type: "local_image", path: file }));
  // Two shapes of the same message: the one that opens a thread carries the
  // instructions, the one that continues a thread does not, because the thread
  // already holds them.
  const opening: UserInput[] = [{ type: "text", text: openingMessage(request) }, ...pictures];
  const following: UserInput[] = [{ type: "text", text: promptText(request) }, ...pictures];

  const state = { failedWith: "", completed: false, lastError: "" };
  try {
    let { events } = await thread.runStreamed(request.sessionId ? following : opening, { signal: request.signal });
    if (request.sessionId) {
      // A thread Codex no longer has (another Codex home, a wiped session) fails before any item; start over then.
      const first = await events.next();
      if (first.done || first.value.type === "error" || first.value.type === "turn.failed") {
        thread = codex.startThread(options);
        // A thread that starts here is new, whatever the tab remembered, so it
        // is opened with the instructions like any other.
        ({ events } = await thread.runStreamed(opening, { signal: request.signal }));
      } else {
        const rest = events;
        const head = first.value;
        events = (async function* () {
          yield head;
          yield* rest;
        })();
      }
    }

    for await (const event of events) {
      out.trace(`[codex] ${JSON.stringify(event).slice(0, 1500)}`);
      report(event, out, state);
    }
  } finally {
    await staged.release();
  }
  if (state.failedWith.length === 0 && !state.completed) {
    state.failedWith =
      state.lastError.length > 0 ? describeFailure(state.lastError) : "Codex ended the stream before the turn completed.";
  }
  if (state.failedWith.length > 0) {
    throw new Error(state.failedWith);
  }
}

const codexDriver: AgentDriver = {
  kind: "codex",
  label: "Codex",
  run,
  generatedImages: newGeneratedImages,
};

export { codexDriver, codexHome, describeFailure };
