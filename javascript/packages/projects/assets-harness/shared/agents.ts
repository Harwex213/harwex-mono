import type { AgentKind, ReasoningEffort, Tab } from "./types.js";

/**
 * The two agents a tab can be built by, and what each of them is asked for.
 * The renderer draws these lists in the composer; the main process hands the
 * chosen slug to that agent's SDK. One catalog, so the two never drift.
 *
 * Both agents get the same job here: the Blender MCP tools of the tab's
 * session, the same two skills, the web, and one way to make a picture that
 * cannot be downloaded. What differs is the CLI behind them and the account
 * that CLI is signed into, which is what the hints below say.
 *
 * A tab holding a slug that is missing from its agent's list keeps it and
 * marks it. A model retired from a list, or released after the list was
 * written, must never turn into something else behind the user's back.
 */

interface AgentModel {
  slug: string;
  label: string;
}

interface AgentInfo {
  kind: Exclude<AgentKind, "">;
  label: string;
  /** What the Clear state says under the agent's name. */
  hint: string;
  models: AgentModel[];
  efforts: ReasoningEffort[];
  /** The effort of a tab that has not picked one. */
  defaultEffort: ReasoningEffort;
}

/**
 * Claude Code, on the Claude Agent SDK. The slugs are the CLI's own aliases,
 * not model ids: `claude --model` takes "an alias for the latest model" and
 * resolves it itself, so `opus` is whichever Opus is current — `claude-opus-5-5`
 * as this is written, where a list written one version ago says `claude-opus-5`
 * and holds every tab on the model before it. A new model reaches this picker
 * on its own; a pinned id has to be noticed and typed.
 *
 * Four families, most capable first. The CLI also has pinned aliases for a tab
 * that must not move — `opus5`, `opus48`, `sonnet46` — which are not offered
 * here, because moving is the point.
 */
const CLAUDE: AgentInfo = {
  kind: "claude",
  label: "Claude Code",
  hint: "Runs on the `claude` CLI and the login it holds. Reaches the web, and `magnific` when a picture has to be invented.",
  models: [
    { slug: "fable", label: "Fable" },
    { slug: "opus", label: "Opus" },
  ],
  efforts: ["low", "medium", "high", "xhigh", "max"],
  defaultEffort: "high",
};

/**
 * Codex, on the Codex SDK. Codex has no alias of the kind Claude's CLI has:
 * `codex --model` takes a slug out of the CLI's own model registry, and these
 * are the slugs that registry holds. So this list does go stale, and a new
 * generation of models is a line to add here.
 *
 * Codex names more efforts than Claude does, down to `minimal` and up through
 * `ultra` and `persistent`.
 */
const CODEX: AgentInfo = {
  kind: "codex",
  label: "Codex",
  hint: "Runs on the `codex` CLI and the ChatGPT account it is signed into. Reaches the web, and makes pictures with `image_gen`.",
  models: [
    { slug: "gpt-6-astra", label: "Astra" },
    { slug: "gpt-6-sol", label: "Sol" },
  ],
  efforts: ["minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"],
  defaultEffort: "high",
};

const AGENTS: AgentInfo[] = [CLAUDE, CODEX];

function agentInfo(kind: AgentKind): AgentInfo | null {
  return AGENTS.find((entry) => entry.kind === kind) ?? null;
}

/**
 * The model a tab's runs use. A tab stores an empty model until the user picks
 * one, and an empty model means the first model of the agent's list. The
 * composer and the runner both read it through here, so the picker shows what
 * the run gets.
 */
function modelOf(tab: Tab): string {
  if (tab.agentModel !== "") {
    return tab.agentModel;
  }
  return agentInfo(tab.agentKind)?.models[0]?.slug ?? "";
}

/**
 * The effort a tab's runs use. A tab stores an empty effort until the user
 * picks one, and an empty effort means the agent's default from this catalog.
 * The composer and the runner both read it through here, so the picker shows
 * what the run gets.
 */
function effortOf(tab: Tab): ReasoningEffort {
  if (tab.reasoningEffort !== "") {
    return tab.reasoningEffort;
  }
  return agentInfo(tab.agentKind)?.defaultEffort ?? "";
}

/** What the agent calls itself, or a placeholder when none has been chosen. */
function agentLabel(kind: AgentKind): string {
  return agentInfo(kind)?.label ?? "No agent";
}

export type { AgentInfo, AgentModel };
export { AGENTS, agentInfo, agentLabel, effortOf, modelOf };
