import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The agent's instructions are the skills under `skills/` — one Markdown file
 * per skill, each with a small front-matter block. The Blender MCP one was
 * written from the blender_mcp repo and teaches every tool; the harness one
 * says how a run in this app is expected to go. They are read on every run, so
 * an edit to a skill reaches the next message without a restart.
 */

// This file runs from dist/electron/agent/, three levels under the package.
const here = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(here, "..", "..", "..", "skills");

interface Skill {
  name: string;
  description: string;
  body: string;
}

function parseSkill(raw: string, fallbackName: string): Skill {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    return { name: fallbackName, description: "", body: raw.trim() };
  }
  const front = match[1] ?? "";
  const body = (match[2] ?? "").trim();
  const field = (key: string): string => {
    const line = front.split("\n").find((entry) => entry.startsWith(`${key}:`));
    return line ? line.slice(key.length + 1).trim() : "";
  };
  return { name: field("name") || fallbackName, description: field("description"), body };
}

async function loadSkills(): Promise<Skill[]> {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  const skills: Skill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      const raw = await readFile(path.join(SKILLS_DIR, entry.name, "SKILL.md"), "utf8");
      skills.push(parseSkill(raw, entry.name));
    } catch {
      // A directory without a SKILL.md is not a skill.
    }
  }
  // The harness skill goes first: it frames how the Blender tools are used here.
  skills.sort((a, b) => {
    if (a.name === "modelgen-harness") {
      return -1;
    }
    if (b.name === "modelgen-harness") {
      return 1;
    }
    return a.name.localeCompare(b.name);
  });
  return skills;
}

export type { Skill };
export { loadSkills, SKILLS_DIR };
