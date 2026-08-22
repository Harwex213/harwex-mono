import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AskEvent, AskRequest, NodeUsage, ToolCall } from "../shared/types.ts";
import { buildPrompt, SYSTEM_PROMPT } from "./prompt.ts";
import type { Store } from "./store.ts";

type Emit = (event: AskEvent) => void;

const IMAGE_LIMIT = 8;

/** Tools a tutor can justify. Nothing that reads or writes the machine. */
const RESEARCH_TOOLS = ["WebSearch", "WebFetch"];

const TOOL_SUMMARY_KEYS = ["query", "url", "prompt", "description", "pattern"];

function summarizeToolInput(input: Record<string, unknown>): string {
  for (const key of TOOL_SUMMARY_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.length > 120 ? `${value.slice(0, 119)}…` : value;
    }
  }
  return "";
}

/**
 * Builds the single user message for the turn. Images have to travel as content
 * blocks, so the prompt always goes in through streaming-input mode.
 */
async function buildUserMessage(
  request: AskRequest,
  text: string,
  store: Store,
  emit: Emit,
): Promise<SDKUserMessage> {
  const blocks: NonNullable<SDKUserMessage["message"]["content"]> = [];
  const images = request.images.slice(0, IMAGE_LIMIT);
  if (request.images.length > images.length) {
    emit({
      type: "notice",
      message: `Only the first ${IMAGE_LIMIT} images were sent.`,
    });
  }
  for (const image of images) {
    const stored = await store.readImage(image.id);
    if (!stored) {
      emit({ type: "notice", message: `Image ${image.name} is missing on disk.` });
      continue;
    }
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: stored.mediaType as "image/png",
        data: stored.bytes.toString("base64"),
      },
    });
  }
  blocks.push({ type: "text", text });
  return {
    type: "user",
    parent_tool_use_id: null,
    message: { role: "user", content: blocks },
  };
}

function emptyUsage(model: string): NodeUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
    durationMs: 0,
    numTurns: 0,
    model,
  };
}

type TurnOutcome = "ok" | "failed" | "fork-unavailable";

/**
 * Runs the question once. Returns `fork-unavailable` when a forked session died
 * before producing any answer, which the caller retries as a rebuild.
 */
async function runTurn(
  request: AskRequest,
  store: Store,
  emit: Emit,
  signal: AbortSignal,
  forceRebuild: boolean,
): Promise<TurnOutcome> {
  const built = buildPrompt(forceRebuild ? { ...request, contextMode: "rebuild" } : request);
  emit({ type: "start", contextUsed: built.contextUsed, sentPrompt: built.text });

  const abortController = new AbortController();
  const forwardAbort = () => {
    abortController.abort();
  };
  signal.addEventListener("abort", forwardAbort, { once: true });

  const options: Options = {
    abortController,
    model: request.model,
    effort: request.effort,
    systemPrompt: SYSTEM_PROMPT,
    thinking: { type: "adaptive", display: "summarized" },
    tools: RESEARCH_TOOLS,
    allowedTools: RESEARCH_TOOLS,
    permissionMode: "dontAsk",
    // No CLAUDE.md, no user settings: a lesson on Roman law must not inherit
    // this repo's code conventions.
    settingSources: [],
    cwd: store.agentCwd,
    includePartialMessages: true,
    maxTurns: 12,
  };
  if (built.contextUsed === "fork" && request.parentSessionId) {
    options.resume = request.parentSessionId;
    options.forkSession = true;
  }

  const userMessage = await buildUserMessage(request, built.text, store, emit);
  const stream = query({
    prompt: (async function* () {
      yield userMessage;
    })(),
    options,
  });

  let sessionId: string | null = null;
  let usage = emptyUsage(request.model);
  let sawResult = false;
  let sawText = false;
  const canRetryAsRebuild = built.contextUsed === "fork";

  const bail = (message: string): TurnOutcome => {
    if (canRetryAsRebuild && !sawText) {
      return "fork-unavailable";
    }
    emit({ type: "error", message });
    return "failed";
  };

  try {
    for await (const message of stream) {
      if (message.session_id && message.session_id !== sessionId) {
        sessionId = message.session_id;
        emit({ type: "session", sessionId });
      }
      if (message.type === "stream_event" && message.parent_tool_use_id === null) {
        const event = message.event;
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            sawText = true;
            emit({ type: "text", delta: event.delta.text });
          } else if (event.delta.type === "thinking_delta") {
            emit({ type: "thinking", delta: event.delta.thinking });
          }
        }
        continue;
      }
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "tool_use") {
            const call: ToolCall = {
              id: block.id,
              name: block.name,
              summary: summarizeToolInput(block.input as Record<string, unknown>),
            };
            emit({ type: "tool", call });
          }
        }
        continue;
      }
      if (message.type === "result") {
        sawResult = true;
        const entries = Object.entries(message.modelUsage);
        const totals = entries.map(([, entry]) => {
          return entry;
        });
        // modelUsage also counts the CLI's internal helper calls, so the model
        // to display is the one that wrote the answer, not the first key.
        const dominant = entries.reduce<[string, number]>(
          (best, [name, entry]) => {
            return entry.outputTokens > best[1] ? [name, entry.outputTokens] : best;
          },
          [request.model, -1],
        );
        usage = {
          inputTokens: totals.reduce((sum, entry) => sum + entry.inputTokens, 0),
          outputTokens: totals.reduce((sum, entry) => sum + entry.outputTokens, 0),
          cacheReadTokens: totals.reduce((sum, entry) => sum + entry.cacheReadInputTokens, 0),
          costUsd: message.total_cost_usd,
          durationMs: message.duration_ms,
          numTurns: message.num_turns,
          model: dominant[0],
        };
        if (message.subtype !== "success") {
          const detail = message.errors.join("; ");
          return bail(
            detail.length > 0
              ? `Agent stopped (${message.subtype}): ${detail}`
              : `Agent stopped: ${message.subtype}`,
          );
        }
        emit({ type: "done", sessionId, usage });
        return "ok";
      }
    }
    if (!sawResult) {
      return bail("The agent closed without returning a result.");
    }
    return "ok";
  } catch (error) {
    if (abortController.signal.aborted || signal.aborted) {
      return "failed";
    }
    return bail(error instanceof Error ? error.message : String(error));
  } finally {
    signal.removeEventListener("abort", forwardAbort);
    stream.close();
  }
}

/**
 * Runs one node's question, pushing every delta out through `emit`. A branch
 * whose parent session has expired falls back to a rebuilt transcript.
 */
async function runAsk(
  request: AskRequest,
  store: Store,
  emit: Emit,
  signal: AbortSignal,
): Promise<void> {
  const outcome = await runTurn(request, store, emit, signal, false);
  if (outcome !== "fork-unavailable" || signal.aborted) {
    return;
  }
  emit({
    type: "notice",
    message: "The parent session was gone, so the branch was rebuilt from the transcript.",
  });
  await runTurn(request, store, emit, signal, true);
}

export { runAsk };
