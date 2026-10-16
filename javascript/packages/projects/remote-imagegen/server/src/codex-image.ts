import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Codex } from "@openai/codex-sdk";
import type { ThreadEvent, UserInput } from "@openai/codex-sdk";
import type { ServerConfig } from "./config.js";
import type { StartLock } from "./limits.js";

/**
 * One generation is one fresh Codex thread. The thread has a single job:
 * call Codex's built-in image_gen once. Codex writes the picture to
 * `$CODEX_HOME/generated_images/<thread_id>/`, and this module reads it from there.
 */

type ReferenceImage = {
  data: Buffer;
  mimeType: string;
};

type ImageSize = "1024x1024" | "1536x1024" | "1024x1536" | "auto";

type ImageRequest = {
  prompt: string;
  references: ReferenceImage[];
  size: ImageSize | undefined;
};

type GeneratedImage = {
  data: Buffer;
  mimeType: string;
  threadId: string;
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const SIZE_HINTS: Record<ImageSize, string | undefined> = {
  "1024x1024": "Size: 1024x1024 (square)",
  "1536x1024": "Size: 1536x1024 (landscape)",
  "1024x1536": "Size: 1024x1536 (portrait)",
  "auto": undefined,
};

const DEVELOPER_INSTRUCTIONS = [
  "You are an image generation worker.",
  "Call the image_gen tool exactly once, passing the user's prompt verbatim (add the size hint only as given).",
  "Pass every attached image as a reference.",
  "Do not write code, do not run commands, do not ask questions, do not describe the image.",
  "After the tool returns, reply DONE.",
].join(" ");

function createCodex(config: ServerConfig): Codex {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }
    // An API key would win over the ChatGPT login. The server token is none of Codex's business.
    if (key === "OPENAI_API_KEY" || key === "CODEX_API_KEY" || key === "REMOTE_IMAGEGEN_TOKEN") {
      continue;
    }
    env[key] = value;
  }
  // With `env` set, the SDK does not inherit process.env, so CODEX_HOME must be in this copy.
  env.CODEX_HOME = config.codexHome;

  return new Codex({
    env,
    ...(config.codexPath ? { codexPathOverride: config.codexPath } : {}),
    config: {
      notify: [],
      developer_instructions: DEVELOPER_INSTRUCTIONS,
      include_permissions_instructions: false,
      include_environment_context: false,
      include_apps_instructions: false,
      project_doc_max_bytes: 0,
      skills: { include_instructions: false },
      // Everything except image generation is off. code_mode_host stays on:
      // the model reaches image_gen through it.
      features: {
        image_generation: true,
        shell_tool: false,
        unified_exec: false,
        view_image: false,
        apps: false,
        plugins: false,
        multi_agent: false,
        browser_use: false,
        computer_use: false,
        goals: false,
        hooks: false,
        tool_suggest: false,
        skill_search: false,
        sleep_tool: false,
        memories: false,
      },
    },
  });
}

/** The newest image file in `dir`, or null when Codex wrote none. */
async function newestImage(dir: string): Promise<string | null> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  let best: { file: string; mtime: number } | null = null;
  for (const name of names) {
    if (!MIME_BY_EXTENSION[path.extname(name).toLowerCase()]) {
      continue;
    }
    const file = path.join(dir, name);
    const info = await stat(file).catch(() => undefined);
    if (!info || !info.isFile()) {
      continue;
    }
    if (!best || info.mtimeMs > best.mtime) {
      best = { file, mtime: info.mtimeMs };
    }
  }
  return best?.file ?? null;
}

class ImageGenerator {
  private readonly codex: Codex;

  constructor(
    private readonly config: ServerConfig,
    private readonly startLock: StartLock,
  ) {
    this.codex = createCodex(config);
  }

  /** Runs one Codex thread. Abort `signal` to kill the Codex child. */
  async generate(request: ImageRequest, signal: AbortSignal): Promise<GeneratedImage> {
    // Short paths on purpose: the model mistyped long reference paths in tests.
    const workDir = await mkdtemp(path.join(os.tmpdir(), "ig-"));
    let threadId: string | null = null;
    try {
      const refPaths: string[] = [];
      for (const [index, ref] of request.references.entries()) {
        const file = path.join(workDir, `ref${index + 1}${EXTENSION_BY_MIME[ref.mimeType] ?? ".png"}`);
        await writeFile(file, ref.data);
        refPaths.push(file);
      }

      const sizeHint = request.size ? SIZE_HINTS[request.size] : undefined;
      const text = sizeHint ? `${request.prompt}\n\n${sizeHint}` : request.prompt;
      const input: UserInput[] = [
        { type: "text", text },
        ...refPaths.map((file): UserInput => ({ type: "local_image", path: file })),
      ];

      const failures: string[] = [];
      const releaseStart = await this.startLock.acquire(signal);
      try {
        const thread = this.codex.startThread({
          model: this.config.model,
          workingDirectory: workDir,
          skipGitRepoCheck: true,
          sandboxMode: "read-only",
          approvalPolicy: "never",
          webSearchMode: "disabled",
          networkAccessEnabled: false,
          modelReasoningEffort: "low",
        });
        const { events } = await thread.runStreamed(input, { signal });
        for await (const event of events) {
          if (event.type === "thread.started") {
            threadId = event.thread_id;
            // The login is loaded once the thread exists. The next thread may start now.
            releaseStart();
          }
          collectFailure(event, failures);
        }
      } finally {
        releaseStart();
      }

      if (!threadId) {
        throw new Error(withDetails("Codex did not start a thread.", failures));
      }
      // The final message is never trusted. Only a file on disk counts.
      const file = await newestImage(this.imageDir(threadId));
      if (!file) {
        throw new Error(withDetails("Codex made no image.", failures));
      }
      const mimeType = MIME_BY_EXTENSION[path.extname(file).toLowerCase()] ?? "image/png";
      return { data: await readFile(file), mimeType, threadId };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
      if (threadId) {
        await rm(this.imageDir(threadId), { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  private imageDir(threadId: string): string {
    return path.join(this.config.codexHome, "generated_images", threadId);
  }
}

function collectFailure(event: ThreadEvent, failures: string[]): void {
  if (event.type === "turn.failed") {
    failures.push(event.error.message);
    return;
  }
  if (event.type === "error") {
    failures.push(event.message);
    return;
  }
  if (event.type === "item.completed" && event.item.type === "error") {
    failures.push(event.item.message);
  }
}

function withDetails(message: string, failures: string[]): string {
  if (failures.length === 0) {
    return message;
  }
  return `${message} ${failures.join(" | ")}`;
}

export { ImageGenerator };
export type { GeneratedImage, ImageRequest, ImageSize, ReferenceImage };
