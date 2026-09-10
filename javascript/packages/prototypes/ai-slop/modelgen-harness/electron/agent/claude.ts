import os from "node:os";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentDriver, TokenCount, TurnReport, TurnRequest } from "./driver.js";
import { promptText, shorten, summariseCode } from "./driver.js";

/**
 * The Claude Code driver. Claude runs through the Claude Agent SDK, which
 * drives the `claude` CLI with the login that CLI already holds, so no API key
 * is involved. One tab is one Claude session, resumed on the next message.
 *
 * Claude reads no settings from the machine: the skills reach it as an appended
 * system prompt instead of a `CLAUDE.md`, so the user's own global instructions
 * — written for their code, not for modelling — stay out of a run.
 */

/** Magnific's published MCP endpoint. It signs itself in through OAuth. */
const MAGNIFIC_URL = "https://mcp.magnific.com";

/** The built-in tools a run may use. The web ones are how it reaches ambientCG and the like. */
const TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch", "TodoWrite"];

/**
 * What a run is allowed to do without being asked — and, under `dontAsk`,
 * the whole of what it is allowed to do at all.
 *
 * A run writes nothing outside its working directory: the textures it
 * downloads land there, and the `.blend` and the renders are written by
 * Blender, not by these tools. So `Write` and `Edit` are scoped to that
 * directory, and Bash runs inside the OS sandbox below.
 */
const ALLOWED = [
  "mcp__modelgen",
  "mcp__magnific",
  "Bash",
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "Write(./**)",
  "Edit(./**)",
];

/**
 * What the sandbox refuses to read. A run reads the rest of the disk freely,
 * and has to: Blender, its libraries, the textures it downloads and the
 * model's own directory sit all over the machine, so a read allowlist would
 * be a list nobody can finish. This is the other end of it — the handful of
 * places a modelling agent has no business in, whatever it is asked.
 */
function deniedReads(): string[] {
  const home = os.homedir();
  const entries = [
    ".ssh",
    ".aws",
    ".gnupg",
    ".netrc",
    ".kube",
    ".config/gh",
    ".config/gcloud",
    ".docker/config.json",
    ".codex/auth.json",
    ".claude/.credentials.json",
  ];
  return entries.flatMap((entry) => {
    const file = path.join(home, entry);
    return [file, `${file}/**`];
  });
}

/** The one line a tool call gets in the progress log. */
function summariseTool(name: string, rawInput: unknown): string {
  const short = name.replace(/^mcp__[^_]+__/, "").replace(/^mcp__/, "");
  const input = typeof rawInput === "object" && rawInput !== null ? (rawInput as Record<string, unknown>) : {};
  const pick = (key: string): string => (typeof input[key] === "string" ? (input[key] as string) : "");
  let detail = "";
  if (short.startsWith("execute_blender_code")) {
    detail = summariseCode(pick("code"));
  } else {
    detail =
      pick("command") ||
      pick("name") ||
      pick("query") ||
      pick("identifier") ||
      pick("output_path") ||
      pick("prompt") ||
      pick("url") ||
      pick("file_path") ||
      pick("pattern");
  }
  detail = shorten(detail, 96);
  return detail.length > 0 ? `${short} — ${detail}` : short;
}

/**
 * Claude names a spent quota in the text of its error, the way Codex does.
 * Say so up front, so the run does not read as a network fault.
 */
function describeFailure(message: string): string {
  if (/usage limit|rate.?limit/i.test(message)) {
    return `Claude usage limit reached. The plan's quota is used up for now. ${message}`;
  }
  return message;
}

/**
 * What a turn spent, over every model the session called. Anthropic reports
 * cache reads apart from `inputTokens`, so `fresh` is the content the model
 * saw for the first time and `cached` is the prompt it re-read — which, on a
 * turn of many tool calls, is the same prompt over and over.
 */
function countTokens(message: Extract<SDKMessage, { type: "result" }>): TokenCount {
  const perModel = Object.values(message.modelUsage ?? {});
  if (perModel.length > 0) {
    return perModel.reduce(
      (total, usage) => {
        return {
          fresh: total.fresh + usage.inputTokens + usage.cacheCreationInputTokens + usage.outputTokens,
          cached: total.cached + usage.cacheReadInputTokens,
        };
      },
      { fresh: 0, cached: 0 },
    );
  }
  const usage = message.usage;
  return {
    fresh: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.output_tokens ?? 0),
    cached: usage.cache_read_input_tokens ?? 0,
  };
}

async function run(request: TurnRequest, out: TurnReport): Promise<void> {
  const controller = new AbortController();
  if (request.signal.aborted) {
    controller.abort();
  }
  request.signal.addEventListener("abort", () => {
    controller.abort();
  });

  const options: Options = {
    abortController: controller,
    cwd: request.refsDir,
    tools: TOOLS,
    allowedTools: ALLOWED,
    // A headless turn has nobody to answer a permission prompt, but that is no
    // reason to wave everything through. `auto` sends what `ALLOWED` does not
    // cover to a classifier, which is what keeps a run from dead-ending on the
    // one thing the list did not anticipate — a texture host, say.
    permissionMode: "auto",
    // Bash runs under the OS sandbox: writes land in the working directory and
    // nowhere else, the same box Codex gets from its `workspace-write` sandbox.
    // The hosts a run downloads from cannot be known in advance, so the network
    // stays open rather than being pinned to an allowlist that would go stale.
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      network: { strictAllowlist: false },
      filesystem: { denyRead: deniedReads() },
    },
    // Nothing on this machine but the skills below should shape the run.
    settingSources: [],
    systemPrompt: { type: "preset", preset: "claude_code", append: request.instructions },
    mcpServers: {
      modelgen: { type: "http", url: request.mcpUrl, timeout: 600_000, alwaysLoad: true },
      magnific: { type: "http", url: MAGNIFIC_URL },
    },
    ...(request.settings.claudeCodePath ? { pathToClaudeCodeExecutable: request.settings.claudeCodePath } : {}),
    ...(request.tab.agentModel ? { model: request.tab.agentModel } : {}),
    ...(request.tab.reasoningEffort ? { effort: request.tab.reasoningEffort as Options["effort"] } : {}),
    ...(request.sessionId ? { resume: request.sessionId } : {}),
  };

  // What each tool call is called, so its result can rewrite its own line.
  const calls = new Map<string, string>();
  let failedWith = "";
  let completed = false;

  for await (const message of query({ prompt: promptText(request), options })) {
    out.trace(`[claude] ${JSON.stringify(message).slice(0, 1500)}`);
    if (message.type === "system" && message.subtype === "init") {
      out.session(message.session_id);
      continue;
    }
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          const line = summariseTool(block.name, block.input);
          calls.set(block.id, line);
          out.step(block.id, `▸ ${line}`);
          continue;
        }
        if (block.type === "thinking" && block.thinking.trim().length > 0) {
          out.summary(shorten(block.thinking, 240));
          continue;
        }
        if (block.type === "text" && block.text.trim().length > 0) {
          out.summary(shorten(block.text, 240));
          out.final(block.text.trim());
        }
      }
      continue;
    }
    if (message.type === "user") {
      const content = message.message.content;
      if (typeof content === "string") {
        continue;
      }
      for (const block of content) {
        if (block.type !== "tool_result") {
          continue;
        }
        const line = calls.get(block.tool_use_id);
        if (line) {
          out.step(block.tool_use_id, `▸ ${line}${block.is_error === true ? " ✗" : " ✓"}`);
        }
      }
      continue;
    }
    if (message.type === "result") {
      out.session(message.session_id);
      out.tokens(countTokens(message));
      if (message.subtype === "success" && !message.is_error) {
        completed = true;
        if (message.result.trim().length > 0) {
          out.final(message.result.trim());
        }
        continue;
      }
      const errors = "errors" in message ? message.errors : [];
      const said = "result" in message && typeof message.result === "string" ? message.result : "";
      failedWith = describeFailure(errors.join("; ") || said || `The run ended as ${message.subtype}.`);
    }
  }

  if (failedWith.length === 0 && !completed) {
    failedWith = controller.signal.aborted ? "Cancelled." : "Claude ended the stream before the turn completed.";
  }
  if (failedWith.length > 0) {
    throw new Error(failedWith);
  }
}

const claudeDriver: AgentDriver = {
  kind: "claude",
  label: "Claude Code",
  run,
};

export { claudeDriver, MAGNIFIC_URL };
