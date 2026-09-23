import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type { BlenderSession, ToolDefinition } from "@hw/headless-blender-mcp";
import type { ChatMessage, ImageKind, MessageImage, SendRequest, Settings, WorkspaceEvent } from "../../shared/types.js";
import {
  addTokens,
  insertImage,
  insertMessage,
  readMessage,
  readSessionId,
  updateMessage,
  writeSessionId,
} from "../chat.js";
import { readTab } from "../db.js";
import { newId, toPng } from "../images.js";
import type { Png } from "../images.js";
import { claudeDriver } from "./claude.js";
import { codexDriver, codexHome } from "./codex.js";
import type { AgentDriver, TurnImage, TurnReport, TurnRequest } from "./driver.js";
import { registerRun } from "./mcp-server.js";
import { loadSkills } from "./skills.js";

/**
 * One agent turn: the user's message goes in, the agent works the tab's
 * Blender session through its MCP tools, and two chat messages come out — a
 * progress log rewritten while the turn goes on, and the final answer with the
 * preview it rendered.
 *
 * Which agent that is belongs to the tab. Everything around it is the same
 * either way, and lives here; what differs is in the driver, one file per
 * agent, behind the interface in `driver.ts`.
 */

interface RunnerDeps {
  emit(event: WorkspaceEvent): void;
  /**
   * Sends the renders of this tab into the run, until the returned function
   * is called. The session hands a render to whoever is listening, and during
   * a turn that is the run's answer message.
   */
  captureRenders(tabId: string, sink: (png: Png, filePath: string) => void): () => void;
  /** Exports the glTF the viewer shows again. */
  refreshModel(tabId: string): void;
  /** The tab's token counts moved. */
  tokensChanged(tabId: string, used: number, cached: number): void;
}

const PROGRESS_THROTTLE_MS = 150;

const DRIVERS: AgentDriver[] = [claudeDriver, codexDriver];

const active = new Map<string, AbortController>();

function driverFor(kind: string): AgentDriver {
  const driver = DRIVERS.find((entry) => entry.kind === kind);
  if (!driver) {
    throw new Error("Choose an agent for this model first.");
  }
  return driver;
}

function isRunning(tabId: string): boolean {
  return active.has(tabId);
}

function cancelRun(tabId: string): void {
  active.get(tabId)?.abort();
}

/**
 * The agent's working directory: one per model, under the app's own data. It
 * is scratch space — what the agent downloads to build the model, and the
 * `AGENTS.md` Codex reads. Nothing is put next to the `.blend`, so a model
 * directory holds the model and nothing else, and the pictures the user
 * attaches never land on disk at all.
 *
 * The path is in the name, hashed, because two models in two directories may
 * be called the same thing.
 */
function workDirFor(blendPath: string): string {
  const parsed = path.parse(blendPath);
  const stamp = createHash("sha1").update(blendPath).digest("hex").slice(0, 8);
  return path.join(app.getPath("userData"), "work", `${parsed.name}-${stamp}`);
}

/**
 * The tools the run offers its agent. They come from the tab's session, so
 * they already work on the tab's file; `open_blend_file` is dropped, because
 * the tab owns that choice and an agent that opened another file would leave
 * the app watching a Blender that no longer exists.
 */
function agentTools(session: BlenderSession): ToolDefinition[] {
  return session.tools().filter((tool) => tool.name !== "open_blend_file");
}

/** The skills and the facts of this run, as the one block of text a driver hands its agent. */
async function buildInstructions(
  driver: AgentDriver,
  blendPath: string,
  workDir: string,
  firstMessage: boolean,
): Promise<string> {
  const skills = await loadSkills();
  const parts = skills.map((skill) => `<skill name="${skill.name}">\n${skill.body}\n</skill>`);
  const facts = [
    "<run-facts>",
    `blend file: ${blendPath}`,
    `working directory (downloads and scratch files, never next to the blend file): ${workDir}`,
    "pictures the user attaches come with the message itself, not as files; nothing of theirs is written to disk",
    `first message of this conversation: ${firstMessage ? "yes — inspect the scene first" : "no — the session remembers what exists"}`,
    "Blender: 5.1, background mode, already connected to your MCP tools (server name: modelgen)",
  ];
  if (driver.kind === "codex") {
    facts.push(`generated images from image_gen land under: ${path.join(codexHome(), "generated_images")}`);
  }
  facts.push("</run-facts>");
  parts.push(facts.join("\n"));
  return parts.join("\n\n");
}

async function runTurn(
  request: SendRequest,
  settings: Settings,
  session: BlenderSession,
  deps: RunnerDeps,
): Promise<void> {
  const tabId = request.tabId;
  if (active.has(tabId)) {
    throw new Error("The agent is already working on this model. Wait for it, or cancel the run.");
  }
  const tab = readTab(tabId);
  if (!tab) {
    throw new Error("That tab is not open.");
  }
  const driver = driverFor(tab.agentKind);
  const controller = new AbortController();
  active.set(tabId, controller);

  const now = Date.now();
  const blendPath = tabId;
  const workDir = workDirFor(blendPath);
  await mkdir(workDir, { recursive: true });

  // The user's message. Its pictures are decoded once and held in memory: the
  // chat draws them from there, and the agent is handed the same bytes.
  const userMessage = insertMessage({
    id: newId("msg"),
    tabId,
    role: "user",
    text: request.text,
    status: "done",
    createdAt: now,
  });
  const turnImages: TurnImage[] = [];
  for (const attachment of request.images) {
    const png = toPng(new Uint8Array(attachment.bytes));
    const id = newId("in");
    userMessage.images.push(
      insertImage({ ...png, id, kind: "input", mime: "image/png", filePath: null, messageId: userMessage.id }),
    );
    turnImages.push({ name: attachment.name || `${id}.png`, mime: "image/png", bytes: png.bytes });
  }
  deps.emit({ type: "message", message: userMessage });

  const progress = insertMessage({
    id: newId("msg"),
    tabId,
    role: "progress",
    text: `Starting ${driver.label}…`,
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

  // Every picture of this turn — the renders, the ones the agent generated —
  // hangs off the answer message.
  let previewCount = 0;
  const attachImage = (kind: ImageKind, png: Png, filePath: string | null): MessageImage => {
    if (kind === "preview") {
      previewCount += 1;
    }
    const image = insertImage({ ...png, id: newId("img"), kind, mime: "image/png", filePath, messageId: answer.id });
    const fresh = readMessage(answer.id);
    if (fresh) {
      deps.emit({ type: "message", message: fresh });
    }
    return image;
  };

  // The progress log: a summary line from the model, then the steps.
  const steps: string[] = [];
  const stepByKey = new Map<string, number>();
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

  const report: TurnReport = {
    session(id: string) {
      writeSessionId(tabId, driver.kind, id);
    },
    step(key: string, line: string) {
      const index = stepByKey.get(key);
      if (index === undefined) {
        stepByKey.set(key, steps.length);
        steps.push(line);
      } else {
        steps[index] = line;
      }
      flush(false);
    },
    summary(text: string) {
      summary = text;
      flush(false);
    },
    final(text: string) {
      finalText = text;
    },
    tokens(count) {
      if (count.fresh <= 0 && count.cached <= 0) {
        return;
      }
      const total = addTokens(tabId, count.fresh, count.cached);
      deps.tokensChanged(tabId, total.used, total.cached);
    },
    trace(line: string) {
      if (process.env.MODELGEN_DEBUG) {
        process.stderr.write(`${line}\n`);
      }
    },
  };

  let failedWith = "";
  const stopCapturing = deps.captureRenders(tabId, (png, filePath) => {
    attachImage("preview", png, filePath);
  });
  const run = registerRun(agentTools(session));
  try {
    const sessionId = readSessionId(tabId, driver.kind);
    const turn: TurnRequest = {
      tab,
      settings,
      blendPath,
      workDir,
      instructions: await buildInstructions(driver, blendPath, workDir, sessionId === null),
      text: request.text,
      images: turnImages,
      mcpUrl: run.url,
      sessionId,
      signal: controller.signal,
    };
    await driver.run(turn, report);
  } catch (error) {
    failedWith = controller.signal.aborted ? "Cancelled." : error instanceof Error ? error.message : String(error);
  } finally {
    if (flushTimer) {
      clearTimeout(flushTimer);
    }
    stopCapturing();
    run.release();
    active.delete(tabId);
  }

  // The scene is whatever the agent left; show it, whether the run ended well or not.
  deps.refreshModel(tabId);

  // Pictures the agent made with its own image tool during this turn join the message.
  for (const file of await (driver.generatedImages?.(now) ?? Promise.resolve([]))) {
    try {
      attachImage("generated", toPng(new Uint8Array(await readFile(file))), file);
    } catch {
      // Not a picture this app can decode.
    }
  }

  if (failedWith.length === 0 && previewCount === 0) {
    try {
      const png = toPng(await session.renderThumbnail(`preview-${Date.now()}`));
      attachImage("preview", png, null);
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
