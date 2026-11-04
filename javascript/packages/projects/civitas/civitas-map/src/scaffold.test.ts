import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

// Pins the package contract: the manifest, the layer rules and the file conventions.

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const srcRoot = path.join(packageRoot, "src");

function readPackageJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as Record<string, unknown>;
}

function collectEntries(directory: string, out: string[], skip: (name: string) => boolean): string[] {
  for (const entry of readdirSync(directory)) {
    if (skip(entry)) {
      continue;
    }
    const full = path.join(directory, entry);
    out.push(full);
    if (statSync(full).isDirectory()) {
      collectEntries(full, out, skip);
    }
  }
  return out;
}

function sourceFiles(): string[] {
  return collectEntries(srcRoot, [], () => {
    return false;
  }).filter((file) => {
    return /\.tsx?$/.test(file);
  });
}

// The layer a file belongs to: the first folder under `src/`, or `null` for the
// files at the root of `src/` (the composition root and the test helpers).
function layerOf(file: string): string | null {
  const relative = path.relative(srcRoot, file).split(path.sep);
  return relative.length > 1 ? relative[0] : null;
}

// Which layers a layer may import from. Anything not listed is a violation.
const ALLOWED: Record<string, string[]> = {
  domain: [],
  datasource: ["domain"],
  store: ["domain", "datasource"],
  actions: ["store", "datasource", "domain"],
  services: ["store", "domain", "actions"],
  ui: ["services", "store", "domain", "actions"],
};

test("package.json pins every version exactly and keeps the scripts", () => {
  const manifest = readPackageJson();

  assert.equal(manifest.name, "@hw/civitas-map");
  for (const group of ["dependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(manifest[group] as Record<string, string>)) {
      assert.match(version, /^\d+\.\d+\.\d+$/, name + " is pinned to \"" + version + "\"");
    }
  }

  const scripts = manifest.scripts as Record<string, string>;
  // An unquoted glob is expanded by the shell, and the runner then errors.
  assert.equal(scripts.test, "tsx --test \"src/**/*.test.ts\" \"dev-server/**/*.test.mjs\"");
});

test("a layer imports only the layers below it, and only through their index", () => {
  const importPattern = /^import\s[^;]*?from\s+"(\.{1,2}\/[^"]+)";/gms;

  for (const file of sourceFiles()) {
    const ownLayer = layerOf(file);
    const body = readFileSync(file, "utf8");

    for (const match of body.matchAll(importPattern)) {
      const target = path.resolve(path.dirname(file), match[1]);
      const targetLayer = layerOf(target + ".ts");
      if (targetLayer === null || targetLayer === ownLayer) {
        if (targetLayer === ownLayer && ownLayer !== "ui") {
          assert.notEqual(
            target,
            path.join(srcRoot, ownLayer ?? "", "index"),
            file + " imports its own layer's index",
          );
        }
        continue;
      }
      if (ownLayer === null) {
        // The composition root and the test helpers may wire any layer. `ui/`
        // has no index: `app.tsx` imports its page by path.
        if (targetLayer !== "ui") {
          assert.equal(path.basename(target), "index", file + " imports " + match[1] + " past the index");
        }
        continue;
      }
      assert.ok(
        ALLOWED[ownLayer]?.includes(targetLayer),
        file + " (" + ownLayer + ") may not import from " + targetLayer,
      );
      assert.equal(
        target,
        path.join(srcRoot, targetLayer, "index"),
        file + " imports " + match[1] + " instead of the " + targetLayer + " index",
      );
    }
  }
});

test("source files obey the grouped-named-export convention", () => {
  // One grouped named export at the end, per javascript/CLAUDE.md.
  // An index.ts is the exception: one `export { ... } from "./file"` per file of its own folder.
  const reExport = /^export\s*(type\s*)?\{[^}]*\}\s*from\s*"([^"]+)";/gm;

  for (const file of sourceFiles().filter((name) => !name.endsWith(".d.ts"))) {
    const body = readFileSync(file, "utf8");
    assert.doesNotMatch(body, /^export default /m, file + " has a default export");
    assert.doesNotMatch(body, /^export \*/m, file + " has a star export");
    assert.doesNotMatch(
      body,
      /^export\s+(const|let|var|function|class|interface|type|enum|async)\b/m,
      file + " has an inline export keyword",
    );

    if (!file.endsWith(path.sep + "index.ts")) {
      assert.doesNotMatch(body, reExport, file + " re-exports; only an index.ts may");
      continue;
    }

    assert.doesNotMatch(body, /^import /m, file + " imports; an index.ts only re-exports");
    const specifiers = [...body.matchAll(reExport)].map((match) => {
      return match[2];
    });
    for (const specifier of specifiers) {
      assert.ok(specifier.startsWith("./"), file + " re-exports " + specifier + " from outside its own folder");
    }
  }
});

test("every file and folder under src/ and e2e/ is named in kebab-case", () => {
  const kebab = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/;
  const skip = (name: string): boolean => {
    // Playwright names its own snapshot folder, and the e2e build output is not source.
    return name === "dist" || name.endsWith("-snapshots");
  };
  const entries = [
    ...collectEntries(srcRoot, [], skip),
    ...collectEntries(path.join(packageRoot, "e2e"), [], skip),
  ];

  for (const entry of entries) {
    assert.match(path.basename(entry), kebab, entry + " is not kebab-case");
  }
});

test("no source file imports a map image into the bundle", () => {
  for (const file of sourceFiles()) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /from\s+"[^"]*\/assets\//, file + " imports from assets/");
  }
});
