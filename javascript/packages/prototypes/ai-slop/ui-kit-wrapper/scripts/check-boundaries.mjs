import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import process from "node:process";

/**
 * An abstraction nobody enforces is a suggestion.
 *
 * One `import { Select } from "@base-ui/react/select"` in a feature file, and the
 * next kit swap has a hole in it that nothing will surface until that screen is
 * opened by hand. This check makes the boundary a build failure instead of a code
 * review habit.
 *
 * In a monorepo you would usually get this from `eslint-plugin-boundaries` or a
 * `no-restricted-imports` rule. The point is that the rule exists somewhere in
 * CI, not which tool writes it.
 */
const root = new URL("..", import.meta.url).pathname;
const appDir = join(root, "src/app");

const forbidden = [
  { pattern: "@base-ui/react", why: "the primitive library the shared kit is built on" },
  { pattern: "@hw/ui-kit-over-base-ui", why: "the shared kit itself" },
  { pattern: "vendor/studio-kit", why: "the project-specific kit" },
  { pattern: "adapters/", why: "an adapter — go through \"@ui\"" },
  { pattern: "@kit", why: "the active adapter — go through \"@ui\"" },
];

const importPattern = /(?:from|import)\s+"([^"]+)"/g;

async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collect(path)));
      continue;
    }
    if (/\.tsx?$/.test(entry.name)) {
      files.push(path);
    }
  }

  return files;
}

const files = await collect(appDir);
const problems = [];

for (const file of files) {
  const source = await readFile(file, "utf8");
  const lines = source.split("\n");

  lines.forEach((line, index) => {
    for (const match of line.matchAll(importPattern)) {
      const specifier = match[1];
      const hit = forbidden.find((rule) => specifier.includes(rule.pattern));
      if (hit) {
        problems.push({
          file: relative(root, file),
          line: index + 1,
          specifier,
          why: hit.why,
        });
      }
    }
  });
}

if (problems.length > 0) {
  console.error(`App code must import UI only from "@ui". ${problems.length} violation(s):\n`);
  for (const problem of problems) {
    console.error(`  ${problem.file}:${problem.line}  "${problem.specifier}" — ${problem.why}`);
  }
  process.exit(1);
}

console.log(`Boundaries OK — ${files.length} app file(s) import UI only from "@ui".`);
