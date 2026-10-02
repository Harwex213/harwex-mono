import { stat } from "node:fs/promises";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { app } from "electron";
import type {
  ImageRunRequest,
  RunEvent,
  RunInput,
  RunRequest,
  RunResult,
} from "../../shared/types.js";
import { imagePath, readPrompt } from "../workspace.js";
import { generateImage } from "./codex-image.js";
import { readConfig } from "./config.js";

type Emit = (event: RunEvent) => void;

const PROMPT_TOOLS = ["Read", "Write", "Glob", "Skill"];

/**
 * The skills ship with the app as a local plugin and are handed to every run,
 * so nothing is written into the working directory and nothing is left behind
 * there, however the app goes away.
 */
const PLUGIN_DIR = path.join(app.getAppPath(), "plugin");

const TOOL_DETAIL_KEYS = ["file_path", "prompt", "command", "url", "pattern", "description"];

/**
 * One run per generator. A rerun cancels the run it replaces. The image runs
 * are Codex threads, not agent turns, and are cancelled through the same map.
 */
const running = new Map<string, AbortController>();

function summarizeInput(input: Record<string, unknown>): string {
  for (const key of TOOL_DETAIL_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.length > 120 ? `${value.slice(0, 119)}…` : value;
    }
  }
  return "";
}

function escapeForBlock(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

/**
 * Turns the wired-in nodes into the text the agent is handed. With
 * `withImages` off, the reference images are left out, because the image run
 * attaches them to the message.
 */
async function describeInputs(dir: string, inputs: RunInput[], withImages = true): Promise<string> {
  const parts: string[] = [];
  for (const input of inputs) {
    if (input.kind === "text") {
      const text = escapeForBlock(input.text);
      if (text.length > 0) {
        parts.push(`<note>\n${text}\n</note>`);
      }
      continue;
    }
    if (input.kind === "prompt") {
      const text = escapeForBlock(await readPrompt(dir, input.id));
      if (text.length > 0) {
        parts.push(`<prompt>\n${text}\n</prompt>`);
      }
      continue;
    }
    if (withImages) {
      parts.push(`<reference-image>images/${input.id}.png</reference-image>`);
    }
  }
  return parts.join("\n\n");
}

async function isNonEmptyFile(file: string): Promise<boolean> {
  try {
    const info = await stat(file);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

interface AgentRun {
  dir: string;
  generatorId: string;
  targetId: string;
  prompt: string;
  /** Built-in tools the run may use. Anything left out is not even offered. */
  tools: string[];
  maxTurns: number;
}

/**
 * Drives one agent turn and reports what it did. The return value says whether
 * the agent finished, not whether the file it was asked for landed: the caller
 * checks the disk, because that is the only claim worth trusting.
 */
async function drive(run: AgentRun, emit: Emit): Promise<string> {
  const previous = running.get(run.generatorId);
  if (previous) {
    previous.abort();
  }
  const abortController = new AbortController();
  running.set(run.generatorId, abortController);

  const config = await readConfig(run.dir);
  const options: Options = {
    abortController,
    cwd: run.dir,
    tools: run.tools,
    allowedTools: run.tools,
    permissionMode: "bypassPermissions",
    plugins: [{ type: "local", path: PLUGIN_DIR }],
    // Skills come only from the plugin, so no settings or stale skills from the machine reach the run.
    settingSources: [],
    maxTurns: run.maxTurns,
  };
  if (config.agentModel) {
    options.model = config.agentModel;
  }

  let lastText = "";
  try {
    for await (const message of query({ prompt: run.prompt, options })) {
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "tool_use") {
            emit({
              type: "tool",
              generatorId: run.generatorId,
              name: block.name,
              detail: summarizeInput(block.input as Record<string, unknown>),
            });
          }
          if (block.type === "text" && block.text.trim().length > 0) {
            lastText = block.text.trim();
            emit({ type: "text", generatorId: run.generatorId, text: lastText });
          }
        }
        continue;
      }
      if (message.type === "result") {
        if (message.subtype !== "success") {
          throw new Error(message.errors.join("; ") || `The run ended as ${message.subtype}.`);
        }
      }
    }
  } finally {
    if (running.get(run.generatorId) === abortController) {
      running.delete(run.generatorId);
    }
  }
  return lastText;
}

function failure(emit: Emit, request: RunRequest, message: string): RunResult {
  emit({
    type: "failed",
    generatorId: request.generatorId,
    targetId: request.targetId,
    message,
  });
  return { ok: false, message };
}

async function runPromptGeneration(request: RunRequest, emit: Emit): Promise<RunResult> {
  emit({ type: "started", generatorId: request.generatorId, targetId: request.targetId });
  const notes = await describeInputs(request.dir, request.inputs);
  const prompt = [
    "Write one image prompt from the sources below.",
    "",
    "Follow the imagen:image-prompt-generator skill. It says where the file goes and what the prompt has to look like.",
    "",
    `Node id: ${request.targetId}`,
    `Write the prompt to: prompts/${request.targetId}.md`,
    "",
    notes.length > 0 ? notes : "<note>(nothing is wired in)</note>",
  ].join("\n");

  try {
    await drive(
      {
        dir: request.dir,
        generatorId: request.generatorId,
        targetId: request.targetId,
        prompt,
        tools: PROMPT_TOOLS,
        maxTurns: 12,
      },
      emit,
    );
  } catch (error) {
    return failure(emit, request, error instanceof Error ? error.message : String(error));
  }

  const written = await readPrompt(request.dir, request.targetId);
  if (written.trim().length === 0) {
    return failure(emit, request, `The run wrote no prompt to prompts/${request.targetId}.md.`);
  }
  emit({
    type: "done",
    generatorId: request.generatorId,
    targetId: request.targetId,
    caption: written.trim(),
  });
  return { ok: true, message: "" };
}

async function runImageGeneration(request: ImageRunRequest, emit: Emit): Promise<RunResult> {
  emit({ type: "started", generatorId: request.generatorId, targetId: request.targetId });
  const notes = await describeInputs(request.dir, request.inputs, false);
  const references = request.inputs
    .filter((input) => input.kind === "image")
    .map((input) => imagePath(request.dir, input.id));
  if (notes.length === 0 && references.length === 0) {
    return failure(emit, request, "Wire a prompt, a note or an image into the generator first.");
  }
  const text = [`Size: ${request.dimensions}`, "", notes.length > 0 ? notes : "<note>(only reference images)</note>"].join(
    "\n",
  );

  const previous = running.get(request.generatorId);
  if (previous) {
    previous.abort();
  }
  const abortController = new AbortController();
  running.set(request.generatorId, abortController);
  try {
    await generateImage({
      dir: request.dir,
      targetId: request.targetId,
      text,
      references,
      signal: abortController.signal,
      onTool: (name, detail) => {
        emit({ type: "tool", generatorId: request.generatorId, name, detail });
      },
      onText: (said) => {
        emit({ type: "text", generatorId: request.generatorId, text: said });
      },
    });
  } catch (error) {
    return failure(emit, request, error instanceof Error ? error.message : String(error));
  } finally {
    if (running.get(request.generatorId) === abortController) {
      running.delete(request.generatorId);
    }
  }

  if (!(await isNonEmptyFile(imagePath(request.dir, request.targetId)))) {
    return failure(emit, request, `The run wrote no image to images/${request.targetId}.png.`);
  }
  emit({
    type: "done",
    generatorId: request.generatorId,
    targetId: request.targetId,
    caption: `${request.model} · ${request.dimensions}`,
  });
  return { ok: true, message: "" };
}

/** Stops whatever a generator is running, if anything is. */
function cancelRun(generatorId: string): void {
  running.get(generatorId)?.abort();
}

export { cancelRun, runImageGeneration, runPromptGeneration };
