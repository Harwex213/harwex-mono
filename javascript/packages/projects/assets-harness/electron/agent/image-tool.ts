import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { Codex } from "@openai/codex-sdk";
import { z } from "zod";
import type { ToolDefinition } from "@hw/headless-blender-mcp";
import type { Settings } from "../../shared/types.js";
import { readCodexAuth, writeCodexAuth } from "../db.js";
import { toPng } from "../images.js";

/**
 * The image tool of a Claude run. Claude has no image model of its own, so
 * the harness serves one more MCP tool, `generate_image`, next to the Blender
 * ones. The tool starts a one-shot Codex SDK thread that calls Codex's
 * built-in `image_gen` and does nothing else.
 *
 * The thread runs on the ChatGPT login the app keeps in SQLite
 * (`codex-login.ts`). It gets a Codex home of its own. The stored `auth.json`
 * is written there before the run, and read back after it, because Codex
 * refreshes the tokens in that file.
 */

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/** The Codex home of image runs. It holds no login, only sessions and the generated images. */
function imageCodexHome(): string {
  return path.join(app.getPath("userData"), "codex-image-home");
}

/** The newest picture under `generated_images` written after `since`. */
async function newestImage(since: number): Promise<string | null> {
  const root = path.join(imageCodexHome(), "generated_images");
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
  await walk(root, 0);
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

/** Runs one Codex thread that makes one picture. Resolves to the file Codex wrote. */
async function generate(prompt: string, settings: Settings): Promise<string> {
  const auth = readCodexAuth();
  if (auth === null) {
    throw new Error("No ChatGPT login for the image tool. The user has to sign in with ChatGPT in the app.");
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
  const codex = new Codex({
    ...(settings.codexPath ? { codexPathOverride: settings.codexPath } : {}),
    env,
  });
  // The thread needs no project: it only calls the image tool.
  const scratch = await mkdtemp(path.join(os.tmpdir(), "assets-harness-image-"));
  const started = Date.now();
  try {
    const thread = codex.startThread({
      workingDirectory: scratch,
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
    });
    const turn = await thread.run(
      [
        "Generate exactly one image with your built-in image_gen tool.",
        "Do not write code, do not run commands, do not ask questions.",
        "When the image exists, reply with one word: done.",
        "",
        "The image:",
        prompt,
      ].join("\n"),
    );
    const file = await newestImage(started);
    if (!file) {
      throw new Error(`Codex made no image. It said: ${turn.finalResponse.trim() || "nothing"}`);
    }
    return file;
  } finally {
    await rm(scratch, { recursive: true, force: true });
    try {
      const refreshed = await readFile(authFile, "utf8");
      if (refreshed !== auth) {
        writeCodexAuth(refreshed);
      }
    } catch {
      // Codex removed the file: the stored login stays as it was.
    }
  }
}

/**
 * The `generate_image` tool. A relative `output_path` is taken from the
 * project folder, and the file always lands inside that folder.
 */
function imageTool(settings: Settings, projectPath: string): ToolDefinition {
  return {
    name: "generate_image",
    description:
      "Generates one picture from a text prompt with the Codex SDK (image_gen) and saves it as a PNG. " +
      "Use it for a decal, a logo, a label or another picture that cannot be found or downloaded. " +
      "It never makes a 3D model.",
    schema: {
      prompt: z.string().describe("What the picture shows, in full detail: subject, style, background, framing."),
      output_path: z
        .string()
        .describe("Where to save the PNG, relative to the project folder, e.g. Assets/textures/<Model>/logo.png."),
    },
    async execute(args: Record<string, unknown>) {
      const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
      const output = typeof args.output_path === "string" ? args.output_path.trim() : "";
      if (prompt.length === 0 || output.length === 0) {
        return { text: "Both prompt and output_path are required.", isError: true };
      }
      const target = path.resolve(projectPath, output);
      if (!target.startsWith(`${projectPath}${path.sep}`)) {
        return { text: "output_path has to be inside the project folder.", isError: true };
      }
      try {
        const file = await oneAtATime(() => generate(prompt, settings));
        await mkdir(path.dirname(target), { recursive: true });
        // Whatever format Codex wrote, the project gets a PNG.
        const png = toPng(await readFile(file));
        await writeFile(target, png.bytes);
        return { text: `Saved ${png.width}x${png.height} PNG to ${target}`, image: png.bytes };
      } catch (error) {
        return { text: error instanceof Error ? error.message : String(error), isError: true };
      }
    },
  };
}

export { imageTool };
