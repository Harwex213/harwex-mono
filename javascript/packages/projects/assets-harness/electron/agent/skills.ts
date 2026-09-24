import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BLENDER_SKILL_PATH } from "@hw/headless-blender-mcp";

/**
 * The agent's instructions are Markdown files with a small front-matter block,
 * read on every run, so an edit to a skill reaches the next message without a
 * restart. There are two: the harness one under `skills/` says how a run in
 * this app is expected to go, and the Blender one ships with
 * `@hw/headless-blender-mcp` next to the tools it describes.
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
  skills.sort((a, b) => a.name.localeCompare(b.name));
  // The harness's own skills frame the run, so the Blender one comes after them.
  skills.push(parseSkill(await readFile(BLENDER_SKILL_PATH, "utf8"), "blender-mcp"));
  return skills;
}

export type { Skill };
export { loadSkills, SKILLS_DIR };
