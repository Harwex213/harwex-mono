import { copyFile, lstat, mkdir, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { Codex } from "@openai/codex-sdk";
import type { ThreadEvent, ThreadItem, ThreadOptions, UserInput } from "@openai/codex-sdk";
import type { ChatMessage, ImageKind, MessageImage, SendRequest, Settings, WorkspaceEvent } from "../../shared/types.js";
import { renderThumbnail } from "../blender/scene.js";
import { insertImage, insertMessage, readMessage, readThreadId, updateMessage, writeThreadId } from "../db.js";
import { newId, toPng } from "../images.js";
import type { Png } from "../images.js";
import { registerRun } from "./mcp-server.js";
import { loadSkills } from "./skills.js";
import type { RunContext } from "./tools.js";

/**
 * One agent turn on Codex: the user's message goes in, Codex works the
 * harness's MCP tools against the tab's Blender, and two chat messages come
 * out — a progress log rewritten while the turn goes on, and the final answer
 * with the preview it rendered. Codex runs through the Codex SDK, which drives
 * the `codex` CLI and its ChatGPT login, so no API key is involved. Every tab
 * is one Codex thread, resumed on the next message.
 */

interface RunnerDeps {
  emit(event: WorkspaceEvent): void;
  /** The scene may have changed: refresh the viewer and the dirty flag. */
  sceneChanged(tabId: string): void;
}

const PROGRESS_THROTTLE_MS = 150;
/** Codex reads AGENTS.md up to this many bytes; the two skills are longer than its default. */
const PROJECT_DOC_MAX_BYTES = 400_000;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const active = new Map<string, AbortController>();

function isRunning(tabId: string): boolean {
  return active.has(tabId);
}

function cancelRun(tabId: string): void {
  active.get(tabId)?.abort();
}

function refsDirFor(blendPath: string): string {
  const parsed = path.parse(blendPath);
  return path.join(parsed.dir, `${parsed.name}.refs`);
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

function shorten(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The one line a tool call gets in the progress log. */
function summariseTool(tool: string, rawArguments: unknown): string {
  const name = tool.replace(/^.*__/, "");
  const args = typeof rawArguments === "object" && rawArguments !== null ? (rawArguments as Record<string, unknown>) : {};
  const pick = (key: string): string => (typeof args[key] === "string" ? (args[key] as string) : "");
  let detail = "";
  if (name.startsWith("execute_blender_code")) {
    const first = pick("code")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    detail = (first ?? "").replace(/^#\s*/, "");
  } else {
    detail = pick("name") || pick("query") || pick("identifier") || pick("output_path") || pick("blend_file");
  }
  detail = shorten(detail, 96);
  return detail.length > 0 ? `${name} — ${detail}` : name;
}

/** Writes the instructions Codex reads from its working directory. */
async function writeAgentsFile(ctx: RunContext, firstMessage: boolean): Promise<void> {
  const skills = await loadSkills();
  const parts = skills.map((skill) => `<skill name="${skill.name}">\n${skill.body}\n</skill>`);
  parts.push(
    [
      "<run-facts>",
      `blend file: ${ctx.blendPath}`,
      `reference pictures directory (your working directory): ${ctx.refsDir}`,
      `first message of this tab: ${firstMessage ? "yes — inspect the scene first" : "no — the thread remembers what exists"}`,
      "Blender: 5.1, background mode, already connected to your MCP tools (server name: modelgen)",
      `generated images from image_gen land under: ${path.join(codexHome(), "generated_images")}`,
      "</run-facts>",
    ].join("\n"),
  );
  await mkdir(ctx.refsDir, { recursive: true });
  await writeFile(path.join(ctx.refsDir, "AGENTS.md"), `${parts.join("\n\n")}\n`, "utf8");
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

async function runTurn(request: SendRequest, settings: Settings, deps: RunnerDeps): Promise<void> {
  const tabId = request.tabId;
  if (active.has(tabId)) {
    throw new Error("The agent is already working on this model. Wait for it, or cancel the run.");
  }
  const controller = new AbortController();
  active.set(tabId, controller);

  const now = Date.now();
  const blendPath = tabId;
  const refsDir = refsDirFor(blendPath);
  await mkdir(refsDir, { recursive: true });

  // The user's message, with its pictures stored in SQLite and on disk.
  const userMessage = insertMessage({
    id: newId("msg"),
    tabId,
    role: "user",
    text: request.text,
    status: "done",
    createdAt: now,
  });
  const attachedPaths: string[] = [];
  for (const attachment of request.images) {
    const png = toPng(new Uint8Array(attachment.bytes));
    const id = newId("in");
    const file = path.join(refsDir, `${id}.png`);
    await writeFile(file, png.bytes);
    userMessage.images.push(
      insertImage({ ...png, id, kind: "input", mime: "image/png", filePath: file, messageId: userMessage.id }),
    );
    attachedPaths.push(file);
  }
  deps.emit({ type: "message", message: userMessage });

  const progress = insertMessage({
    id: newId("msg"),
    tabId,
    role: "progress",
    text: "Starting Codex…",
    status: "running",
    createdAt: now + 1,
  });
  const answer = insertMessage({
    id: newId("msg"),
    tabId,
    role: "agent",
    text: "",
    status: "running",
    createdAt: now + 2,
  });
  deps.emit({ type: "message", message: progress });
  deps.emit({ type: "message", message: answer });

  let previewCount = 0;
  const ctx: RunContext = {
    blendPath,
    refsDir,
    settings,
    attachImage(kind: ImageKind, png: Png, filePath: string | null): MessageImage {
      if (kind === "preview") {
        previewCount += 1;
      }
      const image = insertImage({ ...png, id: newId("img"), kind, mime: "image/png", filePath, messageId: answer.id });
      const fresh = readMessage(answer.id);
      if (fresh) {
        deps.emit({ type: "message", message: fresh });
      }
      return image;
    },
    sceneChanged() {
      deps.sceneChanged(tabId);
    },
  };

  // The progress log: a summary line from the model, then the steps.
  const steps: string[] = [];
  const stepByItem = new Map<string, number>();
  let summary = "";
  let finalText = "";
  let lastFlush = 0;
  let flushTimer: NodeJS.Timeout | null = null;
  const render = (): string => {
    const head = summary.length > 0 ? summary : "Working…";
    return steps.length > 0 ? `${head}\n\n${steps.join("\n")}` : head;
  };
  const flush = (force: boolean) => {
    if (!force && Date.now() - lastFlush < PROGRESS_THROTTLE_MS) {
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flush(true);
        }, PROGRESS_THROTTLE_MS);
      }
      return;
    }
    lastFlush = Date.now();
    const text = render();
    updateMessage(progress.id, text, "running");
    deps.emit({ type: "message", message: { ...progress, text, status: "running" } });
  };
  const setStep = (item: ThreadItem, line: string) => {
    const index = stepByItem.get(item.id);
    if (index === undefined) {
      stepByItem.set(item.id, steps.length);
      steps.push(line);
    } else {
      steps[index] = line;
    }
    flush(false);
  };
  const mark = (status: string): string => (status === "completed" ? " ✓" : status === "failed" ? " ✗" : "");

  const onEvent = (event: ThreadEvent): string | null => {
    if (event.type === "thread.started") {
      writeThreadId(tabId, event.thread_id);
      return null;
    }
    if (event.type === "turn.failed") {
      return event.error.message;
    }
    if (event.type === "error") {
      return event.message;
    }
    if (event.type !== "item.started" && event.type !== "item.updated" && event.type !== "item.completed") {
      return null;
    }
    const item = event.item;
    if (item.type === "mcp_tool_call") {
      // The SDK types say `error?`, the wire says `"error": null`; both mean no error.
      const failed =
        item.status === "failed" ||
        item.error != null ||
        item.result?.content.some((block) => block.type === "text" && /^\s*\{\s*"status"\s*:\s*"error"/.test(block.text)) === true;
      setStep(item, `▸ ${summariseTool(item.tool, item.arguments)}${item.status === "in_progress" ? "" : failed ? " ✗" : " ✓"}`);
      return null;
    }
    if (item.type === "command_execution") {
      setStep(item, `▸ $ ${shorten(item.command, 96)}${mark(item.status)}`);
      return null;
    }
    if (item.type === "web_search") {
      setStep(item, `▸ web search — ${shorten(item.query, 96)}`);
      return null;
    }
    if (item.type === "file_change") {
      setStep(item, `▸ file change — ${item.changes.map((change) => path.basename(change.path)).join(", ")}${mark(item.status)}`);
      return null;
    }
    if (item.type === "reasoning") {
      if (item.text.trim().length > 0) {
        summary = shorten(item.text, 240);
        flush(false);
      }
      return null;
    }
    if (item.type === "agent_message") {
      if (item.text.trim().length > 0) {
        summary = shorten(item.text, 240);
        if (event.type === "item.completed") {
          finalText = item.text.trim();
        }
        flush(false);
      }
      return null;
    }
    if (item.type === "error") {
      setStep(item, `✗ ${shorten(item.message, 300)}`);
    }
    return null;
  };

  const run = registerRun(ctx);
  let failedWith = "";
  try {
    const firstMessage = readThreadId(tabId) === null;
    await writeAgentsFile(ctx, firstMessage);
    const home = await prepareCodexHome();
    const env: Record<string, string> = { CODEX_HOME: home };
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && key !== "CODEX_HOME") {
        env[key] = value;
      }
    }
    const otherServers = Object.fromEntries((await userMcpServerNames()).map((name) => [name, { enabled: false }]));
    const codex = new Codex({
      ...(settings.codexPath ? { codexPathOverride: settings.codexPath } : {}),
      env,
      config: {
        project_doc_max_bytes: PROJECT_DOC_MAX_BYTES,
        mcp_servers: {
          ...otherServers,
          modelgen: {
            url: run.url,
            startup_timeout_sec: 30,
            tool_timeout_sec: 600,
            // The harness's tools are the point of the run; asking is not an option in a headless turn.
            default_tools_approval_mode: "approve",
          },
        },
      },
    });
    const options: ThreadOptions = {
      workingDirectory: refsDir,
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      webSearchMode: "disabled",
      ...(settings.agentModel ? { model: settings.agentModel } : {}),
      ...(settings.reasoningEffort ? { modelReasoningEffort: settings.reasoningEffort as ThreadOptions["modelReasoningEffort"] } : {}),
    };
    const threadId = readThreadId(tabId);
    let thread = threadId ? codex.resumeThread(threadId, options) : codex.startThread(options);

    const lines = [request.text.trim()];
    if (attachedPaths.length > 0) {
      lines.push("", "Attached pictures, saved as files:", ...attachedPaths.map((file) => `- ${file}`));
    }
    const input: UserInput[] = [
      { type: "text", text: lines.join("\n") },
      ...attachedPaths.map((file): UserInput => ({ type: "local_image", path: file })),
    ];

    let { events } = await thread.runStreamed(input, { signal: controller.signal });
    if (threadId) {
      // A thread Codex no longer has (another Codex home, a wiped session) fails before any item; start over then.
      const first = await events.next();
      if (first.done || first.value.type === "error" || first.value.type === "turn.failed") {
        thread = codex.startThread(options);
        ({ events } = await thread.runStreamed(input, { signal: controller.signal }));
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
      if (process.env.MODELGEN_DEBUG) {
        process.stderr.write(`[codex] ${JSON.stringify(event).slice(0, 1500)}\n`);
      }
      const failure = onEvent(event);
      if (failure && failedWith.length === 0) {
        failedWith = failure;
      }
    }
  } catch (error) {
    if (failedWith.length === 0) {
      failedWith = controller.signal.aborted ? "Cancelled." : error instanceof Error ? error.message : String(error);
    }
  } finally {
    if (flushTimer) {
      clearTimeout(flushTimer);
    }
    run.release();
    active.delete(tabId);
  }

  // The scene is whatever the agent left; show it, whether the run ended well or not.
  deps.sceneChanged(tabId);

  // Pictures made with Codex's own image tool during this turn join the message.
  for (const file of await newGeneratedImages(now)) {
    try {
      ctx.attachImage("generated", toPng(new Uint8Array(await readFile(file))), file);
    } catch {
      // Not a picture this app can decode.
    }
  }

  if (failedWith.length === 0 && previewCount === 0) {
    try {
      const png = toPng(await renderThumbnail(settings.blenderMcpDir, blendPath, `preview-${Date.now()}`));
      ctx.attachImage("preview", png, null);
      steps.push("▸ render_thumbnail_to_path — preview rendered by the harness ✓");
    } catch (error) {
      steps.push(`▸ preview render failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const status = failedWith.length > 0 ? "failed" : "done";
  const progressText = failedWith.length > 0 ? `${render()}\n\n✗ ${failedWith}` : render();
  updateMessage(progress.id, progressText, status);
  deps.emit({ type: "message", message: { ...progress, text: progressText, status } });

  const answerText = failedWith.length > 0 ? `The run stopped: ${failedWith}` : finalText.length > 0 ? finalText : "Done.";
  updateMessage(answer.id, answerText, status);
  const finalMessage: ChatMessage | null = readMessage(answer.id);
  if (finalMessage) {
    deps.emit({ type: "message", message: finalMessage });
  }
}

export type { RunnerDeps };
export { cancelRun, isRunning, runTurn };
