import { readFile } from "node:fs/promises";
import path from "node:path";

const CONFIG_FILE = "harness.config.json";

interface HarnessConfig {
  /** Model the prompt run's agent uses. Left out, the Claude Code default is used. */
  agentModel?: string;
}

async function readConfig(dir: string): Promise<HarnessConfig> {
  try {
    const raw = await readFile(path.join(dir, CONFIG_FILE), "utf8");
    return JSON.parse(raw) as HarnessConfig;
  } catch {
    return {};
  }
}

export type { HarnessConfig };
export { readConfig };
