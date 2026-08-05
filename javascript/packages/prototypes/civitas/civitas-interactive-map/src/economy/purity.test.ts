import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

// PURITY IS THE MOST VALUABLE PROPERTY THE ENGINE HAS. `src/economy/` is plain
// TypeScript functions over plain data: no React, no signals, no DOM, no canvas,
// no localStorage, no clock and no random source. T12 wires it to the UI and the
// T05 store persists it. That is what makes every formula testable, and it is
// what this file defends.
//
// This file excludes itself from the token scan, because it necessarily contains
// the very strings it forbids.

const economyDir = fileURLToPath(new URL("./", import.meta.url));
const SELF = "purity.test.ts";

function listSourceFiles(): string[] {
  return readdirSync(economyDir)
    .filter((entry) => {
      return entry.endsWith(".ts");
    })
    .sort();
}

function readSource(name: string): string {
  return readFileSync(economyDir + name, "utf8");
}

function importSpecifiersOf(body: string): string[] {
  const out: string[] = [];
  // Anchored at the start of a line so a string literal containing the word
  // "from" cannot be mistaken for an import.
  const pattern = /^import\s[^"]*"([^"]+)";/gm;
  let match = pattern.exec(body);
  while (match !== null) {
    out.push(match[1] as string);
    match = pattern.exec(body);
  }
  return out;
}

test("the engine imports no React, no signals, no UI and no stylesheet", () => {
  const banned = [
    "react",
    "react-dom",
    "@preact/signals-react",
    "@preact/signals-react/runtime",
  ];
  for (const name of listSourceFiles()) {
    for (const specifier of importSpecifiersOf(readSource(name))) {
      assert.ok(!banned.includes(specifier), name + " imports " + specifier);
      assert.ok(!specifier.includes("/ui/"), name + " imports from the UI layer");
      assert.ok(!specifier.endsWith(".css"), name + " imports a stylesheet");
    }
  }
});

test("the only import from outside src/economy is a type-only one", () => {
  for (const name of listSourceFiles()) {
    const body = readSource(name);
    for (const specifier of importSpecifiersOf(body)) {
      if (specifier.startsWith("./")) {
        continue;
      }
      if (specifier.startsWith("node:") && name.endsWith(".test.ts")) {
        continue;
      }
      // A type-only import erases at build time, so it adds no runtime coupling.
      // Reusing the store's own JSON type is what keeps the persisted slot
      // honest, and it is the single exception the design allows.
      assert.equal(
        specifier,
        "../state/schema",
        name + " reaches outside src/economy for " + specifier,
      );
      const line = body.split("\n").find((candidate) => {
        return candidate.includes("\"" + specifier + "\"");
      });
      assert.ok(line, "the import line for " + specifier + " must be findable");
      const typeOnly = line.trimStart().startsWith("import type ");
      assert.ok(
        typeOnly || name.endsWith(".test.ts"),
        name + " imports " + specifier + " at runtime; it must be type-only",
      );
    }
  }
});

test("no source file reaches for the DOM, storage, a clock or a random source", () => {
  // Assembled from pieces so this file does not trip its own scan.
  const banned = [
    "document" + ".",
    "window" + ".",
    "local" + "Storage",
    "session" + "Storage",
    "Math." + "random",
    "new " + "Date",
    "Date." + "now",
    "performance" + ".now",
    "structured" + "Clone",
    "fetch(",
    "console" + ".",
    "require(",
  ];
  const sources = listSourceFiles().filter((name) => {
    return !name.endsWith(".test.ts");
  });
  assert.ok(sources.length >= 17, "the engine must have its source files");

  for (const name of sources) {
    const body = readSource(name);
    for (const token of banned) {
      assert.ok(!body.includes(token), name + " contains \"" + token + "\"");
    }
  }
});

test("every source file ends with exactly one grouped named export", () => {
  // javascript/CLAUDE.md: one grouped named export at the end of a file, no
  // inline export keyword, no default export. Nothing else in the package checks
  // the "exactly one, and it is last" half.
  for (const name of listSourceFiles()) {
    const body = readSource(name);
    if (name.endsWith(".test.ts")) {
      assert.doesNotMatch(body, /^export\b/m, name + " is a test and must export nothing");
      continue;
    }
    const occurrences = body.split("export {").length - 1;
    assert.equal(occurrences, 1, name + " must have exactly one grouped export");
    assert.doesNotMatch(body, /^export default /m, name + " has a default export");
    assert.doesNotMatch(
      body,
      /^export\s+(const|let|var|function|class|interface|type|enum|async)\b/m,
      name + " has an inline export keyword",
    );
    const trailing = body.slice(body.indexOf("export {"));
    assert.match(trailing, /^export \{[\s\S]*\};\s*$/, name + " must end on its export");
  }
});

test("the source and test files pair up", () => {
  const files = listSourceFiles();
  const sources = files.filter((name) => {
    return !name.endsWith(".test.ts");
  });
  const tests = new Set(files.filter((name) => {
    return name.endsWith(".test.ts");
  }));

  // `types.ts` has no runtime and `derive.ts` is covered by the two fixtures.
  const exempt = new Set(["types.ts", "derive.ts"]);
  for (const name of sources) {
    if (exempt.has(name)) {
      continue;
    }
    const expected = name.replace(/\.ts$/, ".test.ts");
    assert.ok(tests.has(expected), name + " has no test file");
  }
  assert.ok(tests.has("fixture.test.ts"));
  assert.ok(tests.has("clean-turn.test.ts"));
  assert.ok(tests.has(SELF));
});
