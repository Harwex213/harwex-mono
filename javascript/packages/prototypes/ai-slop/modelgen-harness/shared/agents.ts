import type { AgentKind, ReasoningEffort } from "./types.js";

/**
 * The two agents a tab can be built by, and what each of them is asked for.
 * The renderer draws these lists in the composer; the main process hands the
 * chosen slug to that agent's SDK. One catalog, so the two never drift.
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
}

const CLAUDE: AgentInfo = {
  kind: "claude",
  label: "Claude Code",
  hint: "Runs on the `claude` CLI and the login it holds.",
  models: [
    { slug: "", label: "model: default" },
    { slug: "claude-opus-5", label: "Opus 5" },
    { slug: "claude-sonnet-5", label: "Sonnet 5" },
    { slug: "claude-fable-5-1", label: "Fable 5.1" },
    { slug: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  ],
  efforts: ["", "low", "medium", "high", "xhigh", "max"],
};

/**
 * The models Codex recommends, from <https://learn.chatgpt.com/docs/models>.
 * The legacy ones are left out, but a tab that holds a slug missing from this
 * list keeps it and shows it: a model retired here, or one released after this
 * list was written, must not silently turn into something else.
 */
const CODEX: AgentInfo = {
  kind: "codex",
  label: "Codex",
  hint: "Runs on the `codex` CLI and the ChatGPT account it is signed into.",
  models: [
    { slug: "", label: "model: default" },
    { slug: "gpt-6-astra", label: "Astra" },
    { slug: "gpt-5.6-sol", label: "5.6 Sol" },
    { slug: "gpt-5.6-terra", label: "5.6 Terra" },
    { slug: "gpt-5.6-luna", label: "5.6 Luna" },
    { slug: "gpt-5.3-codex-spark", label: "5.3 Codex Spark" },
  ],
  efforts: ["", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"],
};

const AGENTS: AgentInfo[] = [CLAUDE, CODEX];

function agentInfo(kind: AgentKind): AgentInfo | null {
  return AGENTS.find((entry) => entry.kind === kind) ?? null;
}

/** What the agent calls itself, or a placeholder when none has been chosen. */
function agentLabel(kind: AgentKind): string {
  return agentInfo(kind)?.label ?? "No agent";
}

export type { AgentInfo, AgentModel };
export { AGENTS, agentInfo, agentLabel };
