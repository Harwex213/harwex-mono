import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Codex } from "@openai/codex-sdk";
import type { ThreadEvent, UserInput } from "@openai/codex-sdk";
import { app, nativeImage } from "electron";
import { codexPath } from "../codex-login.js";
import { imagePath, writeImage } from "../workspace.js";
import { readCodexAuth, writeCodexAuth } from "../workspaces.js";

/**
 * The image run. One Codex SDK thread calls Codex's built-in `image_gen` and
 * does nothing else. The app then takes the picture Codex wrote under its
 * home and stores it as `images/<node-id>.png`.
 *
 * The thread runs on the ChatGPT login the app keeps in SQLite
 * (`codex-login.ts`). It gets a Codex home of its own. The stored `auth.json`
 * is written there before the run, and read back after it, because Codex
 * refreshes the tokens in that file.
 */

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

interface ImageJob {
  dir: string;
  targetId: string;
  /** The prompt, the notes and the size, as one block of text. */
  text: string;
  /** Reference images, as absolute paths. */
  references: string[];
  signal: AbortSignal;
  onTool(name: string, detail: string): void;
  onText(text: string): void;
}

/** The Codex home of image runs. It holds the login, the sessions and the generated images. */
function imageCodexHome(): string {
  return path.join(app.getPath("userData"), "codex-image-home");
}

/** The newest picture under `generated_images` written after `since`. */
async function newestImage(since: number): Promise<string | null> {
  const found: { file: string; mtime: number }[] = [];
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
          found.push({ file, mtime: info.mtimeMs });
        }
      } catch {
        // Gone between listing and stat.
      }
    }
  };
  await walk(path.join(imageCodexHome(), "generated_images"), 0);
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0]?.file ?? null;
}

/**
 * Image runs share one Codex home and one `auth.json`, so they go one at a
 * time. Otherwise one run could write back tokens another run has already
 * refreshed.
 */
let queue: Promise<unknown> = Promise.resolve();

function oneAtATime<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

function report(event: ThreadEvent, job: ImageJob, state: { failedWith: string; lastText: string }): void {
  if (event.type === "turn.failed") {
    state.failedWith = event.error.message;
    return;
  }
  if (event.type === "error") {
    state.failedWith = event.message;
    return;
  }
  if (event.type !== "item.started" && event.type !== "item.completed") {
    return;
  }
  const item = event.item;
  if (event.type === "item.started" && item.type === "mcp_tool_call") {
    job.onTool(item.tool, "");
    return;
  }
  if (event.type === "item.started" && item.type === "command_execution") {
    job.onTool("shell", item.command);
    return;
  }
  if (event.type === "item.completed" && item.type === "agent_message" && item.text.trim().length > 0) {
    state.lastText = item.text.trim();
    job.onText(state.lastText);
  }
}

async function runThread(job: ImageJob): Promise<string> {
  const auth = readCodexAuth();
  if (auth === null) {
    throw new Error("No ChatGPT login. Sign in with ChatGPT first.");
  }
  const home = imageCodexHome();
  await mkdir(home, { recursive: true });
  const authFile = path.join(home, "auth.json");
  await writeFile(authFile, auth, { mode: 0o600 });

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // An API key in the environment would win over the ChatGPT login.
    if (value !== undefined && key !== "CODEX_API_KEY" && key !== "OPENAI_API_KEY") {
      env[key] = value;
    }
  }
  env.CODEX_HOME = home;
  const executable = codexPath();
  const codex = new Codex({ ...(executable ? { codexPathOverride: executable } : {}), env });

  const started = Date.now();
  const state = { failedWith: "", lastText: "" };
  try {
    const thread = codex.startThread({
      workingDirectory: job.dir,
      skipGitRepoCheck: true,
      // Codex only calls its image tool. The app writes the file into images/.
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
    });
    const input: UserInput[] = [
      {
        type: "text",
        text: [
          "Generate exactly one image with your built-in image_gen tool.",
          "Do not write code, do not run commands, do not write files, do not ask questions.",
          job.references.length > 0 ? "The attached images are references for it." : "",
          "When the image exists, reply with one word: done.",
          "",
          job.text,
        ].join("\n"),
      },
      ...job.references.map((file): UserInput => ({ type: "local_image", path: file })),
    ];
    const { events } = await thread.runStreamed(input, { signal: job.signal });
    for await (const event of events) {
      report(event, job, state);
    }
  } finally {
    try {
      const refreshed = await readFile(authFile, "utf8");
      if (refreshed !== auth) {
        writeCodexAuth(refreshed);
      }
    } catch {
      // Codex removed the file: the stored login stays as it was.
    }
  }

  const file = await newestImage(started);
  if (!file) {
    const said = state.failedWith || state.lastText;
    throw new Error(`Codex made no image.${said.length > 0 ? ` ${said}` : ""}`);
  }
  // Whatever format Codex wrote, the node gets a PNG.
  const image = nativeImage.createFromBuffer(await readFile(file));
  if (image.isEmpty()) {
    throw new Error(`Codex wrote ${path.basename(file)}, which is not an image the app can decode.`);
  }
  await writeImage(job.dir, job.targetId, new Uint8Array(image.toPNG()));
  return imagePath(job.dir, job.targetId);
}

/** Generates one image and writes it to `images/<targetId>.png`. Resolves to that path. */
function generateImage(job: ImageJob): Promise<string> {
  return oneAtATime(() => runThread(job));
}

export type { ImageJob };
export { generateImage };
