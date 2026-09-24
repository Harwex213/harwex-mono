import type { AgentKind, Settings, Tab } from "../../shared/types.js";

/**
 * What the two agents have in common. A tab picks one of them, and the runner
 * drives it through this interface: it hands over one turn and is told back
 * what to draw — the summary line, the steps, the answer, the tokens.
 *
 * Everything below this line is the same for both agents: the same MCP tools
 * against the same Blender, the same skills, the same chat messages. What a
 * driver holds is only how its agent is started, what its events are called,
 * and how its own conversation is resumed.
 */

/**
 * The name the harness's Blender tools are served under, to both agents. It is
 * a name no user config is likely to hold: Codex merges the run's config into
 * the user's `config.toml`, and a user server of the same name — a stdio
 * `blender` server, say — would get the harness's `url` on top of its own
 * `command`, which Codex refuses to load.
 */
const MCP_SERVER_NAME = "harness_blender";

/** A picture the user attached, as bytes. It is never written next to the model. */
interface TurnImage {
  /** What to call it when an agent needs a name for it. */
  name: string;
  mime: string;
  bytes: Uint8Array;
}

/** What one turn is asked to do. */
interface TurnRequest {
  tab: Tab;
  settings: Settings;
  blendPath: string;
  /**
   * The agent's working directory: the project folder. The agent runs there so
   * that the project's own instructions (`CLAUDE.md`, `AGENTS.md`, its skills)
   * shape the run, and so that what it writes lands in the project.
   */
  workDir: string;
  /** The skills, the project's assets and the run facts, as one block of text. */
  instructions: string;
  /** The user's message. */
  text: string;
  /** The pictures attached to this message, held in memory and handed to the agent as content. */
  images: TurnImage[];
  /** The harness's MCP endpoint for this run, with its one-time path. */
  mcpUrl: string;
  /** The conversation to resume, when the tab already has one. */
  sessionId: string | null;
  signal: AbortSignal;
}

/**
 * What a turn cost. `fresh` is what the model read for the first time;
 * `cached` is prompt it had already seen and read again, which every tool
 * call repeats and which bills at a fraction of the price. Kept apart
 * because one total hides the difference: a five-step turn re-reads the same
 * prompt five times, and counting that as work makes a cube look like a
 * cathedral.
 */
interface TokenCount {
  fresh: number;
  cached: number;
}

/** How a driver reports a turn back to the runner. */
interface TurnReport {
  /** The conversation this turn belongs to, so the next message resumes it. */
  session(id: string): void;
  /**
   * One line of the progress log. `key` identifies the step, so a call that
   * starts and later finishes rewrites its own line instead of adding one.
   */
  step(key: string, line: string): void;
  /** The line above the steps: the agent's latest thought. */
  summary(text: string): void;
  /** The agent's closing answer. */
  final(text: string): void;
  /** What this turn cost, split into new content and re-read prompt. */
  tokens(count: TokenCount): void;
  /** Raw agent events, when `ASSETS_HARNESS_DEBUG` is set. */
  trace(line: string): void;
}

interface AgentDriver {
  kind: Exclude<AgentKind, "">;
  /** What the chat calls this agent. Same string as the shared catalog's. */
  label: string;
  /** Runs one turn. Throws when the turn does not complete. */
  run(request: TurnRequest, report: TurnReport): Promise<void>;
  /**
   * Pictures the agent made with its own image tool during the turn, as file
   * paths. Agents without such a tool leave this out.
   */
  generatedImages?(since: number): Promise<string[]>;
}

/** Long lines are cut to one, so a step reads as a step. */
function shorten(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * What one `execute_blender_code` call is doing, in a few words. The skills
 * ask for a one-line comment at the top of every code block, so that comment
 * is the summary when it is there; the first line of code stands in when it
 * is not.
 */
function summariseCode(code: string): string {
  const lines = code
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const comment = lines.slice(0, 4).find((line) => line.startsWith("#"));
  return (comment ?? lines[0] ?? "").replace(/^#+\s*/, "");
}

/** The message the user typed, and a word about the pictures that came with it. */
function promptText(request: TurnRequest): string {
  const lines = [request.text.trim()];
  if (request.images.length > 0) {
    const count = request.images.length;
    lines.push(
      "",
      `${count} picture${count === 1 ? "" : "s"} came with this message. ${count === 1 ? "It is" : "They are"} attached here, not on disk.`,
    );
  }
  return lines.join("\n");
}

export type { AgentDriver, TokenCount, TurnImage, TurnReport, TurnRequest };
export { MCP_SERVER_NAME, promptText, shorten, summariseCode };
