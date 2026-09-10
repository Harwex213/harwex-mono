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

/** What one turn is asked to do. */
interface TurnRequest {
  tab: Tab;
  settings: Settings;
  blendPath: string;
  /** The agent's working directory: reference pictures next to the `.blend`. */
  refsDir: string;
  /** The skills and the run facts, as one block of text. */
  instructions: string;
  /** The user's message. */
  text: string;
  /** PNG files of the pictures the user attached, in the working directory. */
  attachedPaths: string[];
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
  /** Raw agent events, when `MODELGEN_DEBUG` is set. */
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

/** The message the user typed, plus where the pictures they attached now sit. */
function promptText(request: TurnRequest): string {
  const lines = [request.text.trim()];
  if (request.attachedPaths.length > 0) {
    lines.push("", "Attached pictures, saved as files:", ...request.attachedPaths.map((file) => `- ${file}`));
  }
  return lines.join("\n");
}

export type { AgentDriver, TokenCount, TurnReport, TurnRequest };
export { promptText, shorten, summariseCode };
