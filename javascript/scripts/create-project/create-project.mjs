/**
 * Plan:
 * - ask for project name (kebab-case-naming-style)
 * - ask for project path (relative to javascript folder)
 * - copy-paste tempalte
 * - change variable `$change-that` in `package.json` to project name
 * - change variable `$ChangeThat` in `index.html` to project name with transformation to plain text
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CATEGORIES = ["prototypes", "projects", "learning", "parsers", "irl", "infrastructure"];

const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".css", ".html", ".json", ".md"]);

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function toTitleCase(kebab) {
  return kebab
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function copyDir(src, dest, replacer) {
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, replacer);
    } else {
      const ext = path.extname(entry.name);
      if (TEXT_EXTENSIONS.has(ext) || entry.name.endsWith(".d.ts")) {
        const content = fs.readFileSync(srcPath, "utf8");
        fs.writeFileSync(destPath, replacer(content), "utf8");
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let name = "";
  while (!name) {
    const input = (await prompt(rl, "Project name (kebab-case): ")).trim();
    if (!/^[a-z][a-z0-9-]*$/.test(input)) {
      console.error("  Must be kebab-case (e.g. my-project). Try again.");
    } else {
      name = input;
    }
  }

  console.log(`  Categories: ${CATEGORIES.join(", ")}`);
  let category = "";
  while (!category) {
    const input = (await prompt(rl, "Category: ")).trim();
    if (!CATEGORIES.includes(input)) {
      console.error(`  Unknown category. Choose from: ${CATEGORIES.join(", ")}`);
    } else {
      category = input;
    }
  }

  rl.close();

  const templateDir = path.join(__dirname, "template");
  const destDir = path.join(__dirname, "../../packages", category, name);

  if (fs.existsSync(destDir)) {
    console.error(`Error: destination already exists:\n  ${destDir}`);
    process.exit(1);
  }

  const titleName = toTitleCase(name);

  const replacer = (content) =>
    content
      .replace(/\$change-that/g, name)
      .replace(/\$ChangeThat/g, titleName);

  copyDir(templateDir, destDir, replacer);

  console.log(`\nCreated ${category}/${name}`);
  console.log(`  → ${destDir}`);
}

main();
