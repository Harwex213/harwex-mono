import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The vendored slice of the Blender MCP server and the skill sit at the
 * package root, next to `src/` and `dist/`. This file runs from a different
 * depth once it is compiled, so the root is found by walking up to the
 * `package.json` rather than by counting directories.
 */

function findPackageRoot(): string {
  const start = path.dirname(fileURLToPath(import.meta.url));
  let dir = start;
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error(`Cannot find the package root: no package.json above ${start}.`);
}

const PACKAGE_ROOT = findPackageRoot();
/** Where the CLI lands after `yarn build`, for the MCP configs to point at. */
const CLI_ENTRY = path.join(PACKAGE_ROOT, "dist", "cli", "main.js");
const VENDOR_DIR = path.join(PACKAGE_ROOT, "vendor", "blender-mcp");
const TOOLS_DIR = path.join(VENDOR_DIR, "tools");
const PYTHON_DIR = path.join(VENDOR_DIR, "python");
const SKILLS_DIR = path.join(PACKAGE_ROOT, "skills");
/** The skill that teaches an agent this tool set. */
const BLENDER_SKILL_PATH = path.join(SKILLS_DIR, "blender-mcp", "SKILL.md");

export { BLENDER_SKILL_PATH, CLI_ENTRY, PACKAGE_ROOT, PYTHON_DIR, SKILLS_DIR, TOOLS_DIR, VENDOR_DIR };
