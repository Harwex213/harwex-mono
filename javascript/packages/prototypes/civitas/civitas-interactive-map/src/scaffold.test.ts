import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

// T01 built no runtime logic — it built a contract: a workspace manifest, a build
// config and a TS config whose exact values later tasks depend on. These tests
// pin that contract. Every case below maps to a failure mode named in
// `.plan/T01/DESIGN.md` section 13.

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

function readPackageFile(relativePath: string): string {
  return readFileSync(packageRoot + relativePath, "utf8");
}

function readPackageJson(): Record<string, unknown> {
  return JSON.parse(readPackageFile("package.json")) as Record<string, unknown>;
}

function readTsconfig(): Record<string, unknown> {
  return JSON.parse(readPackageFile("tsconfig.json")) as Record<string, unknown>;
}

function collectSourceFiles(directory: string, out: string[]): string[] {
  for (const entry of readdirSync(directory)) {
    const full = directory + "/" + entry;
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

test("package.json identifies the workspace exactly as the plan requires", () => {
  const manifest = readPackageJson();

  assert.equal(manifest.name, "@hw/civitas-interactive-map");
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, "module");
});

test("every dependency version is exact — no caret, tilde or range", () => {
  // DESIGN 13.2: `defaultSemverRangePrefix: ""` only governs `yarn add`. A
  // hand-written range survives verbatim and silently drifts the resolution away
  // from `../civitas-map`.
  const manifest = readPackageJson();
  const groups = ["dependencies", "devDependencies"] as const;

  for (const group of groups) {
    const entries = manifest[group] as Record<string, string>;
    assert.ok(entries, group + " must exist");
    for (const [name, version] of Object.entries(entries)) {
      assert.match(
        version,
        /^\d+\.\d+\.\d+$/,
        name + " is pinned to \"" + version + "\"; exact x.y.z is required",
      );
    }
  }
});

test("the versions pinned to ../civitas-map have not drifted", () => {
  const manifest = readPackageJson();
  const dependencies = manifest.dependencies as Record<string, string>;
  const devDependencies = manifest.devDependencies as Record<string, string>;

  assert.equal(dependencies.react, "19.2.0");
  assert.equal(dependencies["react-dom"], "19.2.0");
  assert.equal(dependencies["@preact/signals-react"], "3.9.0");
  assert.equal(devDependencies["@rspack/cli"], "2.1.4");
  assert.equal(devDependencies["@rspack/core"], "2.1.4");
  // Deliberately 2.1.0, not 2.1.4 — see DESIGN section 2. A "fix" to 2.1.4 is a
  // regression, not an improvement.
  assert.equal(devDependencies["@rspack/dev-server"], "2.1.0");
  assert.equal(devDependencies.typescript, "5.9.3");
  assert.equal(devDependencies.tsx, "4.19.4");
});

test("the test script keeps its quoted glob so the shell cannot expand it", () => {
  // DESIGN 13.7: an unquoted glob makes the runner error instead of reporting
  // the matched files.
  const manifest = readPackageJson();
  const scripts = manifest.scripts as Record<string, string>;

  assert.equal(scripts.test, "tsx --test \"src/**/*.test.ts\"");
  assert.equal(scripts.dev, "rspack serve");
  assert.equal(scripts.build, "rspack build");
  assert.equal(scripts.typecheck, "tsc --noEmit");
});

test("tsconfig stays standalone and strict", () => {
  const tsconfig = readTsconfig();
  const options = tsconfig.compilerOptions as Record<string, unknown>;

  // DESIGN 4: it must NOT extend @hw/typescript-config, and it must carry no
  // path aliases — later tasks import by relative path only.
  assert.equal(tsconfig.extends, undefined);
  assert.equal(options.paths, undefined);
  assert.equal(options.strict, true);
  assert.equal(options.noUnusedLocals, true);
  assert.equal(options.noUnusedParameters, true);
  assert.equal(options.noEmit, true);
  assert.equal(options.jsx, "react-jsx");
  assert.equal(options.target, "ES2020");
  assert.equal(options.moduleResolution, "bundler");
  assert.deepEqual(options.lib, ["ES2024", "DOM", "DOM.Iterable"]);
});

test("tsconfig include covers src, so env.d.ts is type-checked", () => {
  // DESIGN 13.3: `styles` goes untyped the moment env.d.ts drops out of the
  // program.
  const tsconfig = readTsconfig();

  assert.deepEqual(tsconfig.include, ["src"]);
  const ambient = readPackageFile("src/env.d.ts");
  assert.match(ambient, /declare module "\*\.module\.css"/);
  assert.match(ambient, /declare module "\*\.css"/);
  // Longest-match resolution needs the more specific pattern declared first.
  assert.ok(
    ambient.indexOf("\"*.module.css\"") < ambient.indexOf("\"*.css\""),
    "*.module.css must be declared before *.css",
  );
});

test("index.html keeps both the id and the class the app mounts on", () => {
  // DESIGN 13.8: losing id="root" gives "Target container is not a DOM element".
  // Losing class="root" silently collapses the map to zero height in T03.
  const html = readPackageFile("index.html");

  assert.match(html, /id="root"/);
  assert.match(html, /class="root"/);

  const css = readPackageFile("src/index.css");
  assert.match(css, /\.root/);
});

test("no source file imports a map asset into the bundle", () => {
  // DESIGN 13.6: the production asset mechanism is T02's decision. An import of
  // assets/map.png here adds 2.6 MB to dist and silently passes the build.
  const sources = collectSourceFiles(packageRoot + "src", []);
  assert.ok(sources.length > 0, "src must contain source files");

  for (const file of sources) {
    const body = readFileSync(file, "utf8");
    assert.doesNotMatch(body, /from\s+"[^"]*\/assets\//, file + " imports from assets/");
    assert.doesNotMatch(body, /import\s+"[^"]*\.(png|jpg)"/, file + " imports an image");
  }
});

test("source files obey the grouped-named-export convention", () => {
  // javascript/CLAUDE.md: one grouped named export at the end of a file, no
  // inline `export` keyword, no default export. Ambient .d.ts files are exempt —
  // `declare module` blocks legitimately carry `export default`.
  const sources = collectSourceFiles(packageRoot + "src", []).filter((file) => {
    return !file.endsWith(".d.ts");
  });

  for (const file of sources) {
    const body = readFileSync(file, "utf8");
    assert.doesNotMatch(body, /^export default /m, file + " has a default export");
    assert.doesNotMatch(
      body,
      /^export\s+(const|let|var|function|class|interface|type|enum|async)\b/m,
      file + " has an inline export keyword",
    );
  }
});

test("rspack config keeps the settings CSS modules and JSX depend on", async () => {
  // Imported rather than string-matched: the values, not the formatting, are the
  // contract. The specifier is computed so `tsc` leaves this .mjs out of the
  // program (tsconfig has no allowJs).
  const configUrl = new URL("../rspack.config.mjs", import.meta.url).href;
  const loaded = await import(configUrl);
  const config = loaded.default;

  assert.equal(config.entry.main, "./src/main.tsx");
  assert.equal(config.output.clean, true);
  assert.deepEqual(config.resolve.extensions, ["...", ".ts", ".tsx"]);

  // Both halves are required for `import styles from "./x.module.css"` to yield
  // a default object with camelCased keys.
  assert.equal(config.module.parser["css/auto"].namedExports, false);
  assert.equal(config.module.generator["css/auto"].exportsConvention, "camel-case-only");

  const tsRule = config.module.rules.find((rule: { test: RegExp }) => {
    return rule.test.source === /\.tsx?$/.source;
  });
  assert.ok(tsRule, "a rule for .ts/.tsx must exist");
  assert.equal(tsRule.loader, "builtin:swc-loader");
  assert.equal(tsRule.options.jsc.transform.react.runtime, "automatic");
  assert.equal(tsRule.options.jsc.parser.tsx, true);
  // DESIGN 3: without this rspack treats the module as ESM-strict and the
  // automatic JSX runtime import breaks.
  assert.equal(tsRule.type, "javascript/auto");

  const cssRule = config.module.rules.find((rule: { test: RegExp }) => {
    return rule.test.source === /\.css$/i.source;
  });
  assert.ok(cssRule, "a rule for .css must exist");
  assert.equal(cssRule.type, "css/auto");

  // A fixed port lets a forgotten server answer with a stale bundle.
  assert.equal(config.devServer.port, 0);
  assert.equal(config.devServer.static.directory, "./assets");
  assert.equal(config.devServer.static.publicPath, "/assets");

  // T02 added CopyRspackPlugin. Assets are copied, never imported — the import
  // guard above still holds.
  assert.equal(config.plugins.length, 2);
  const copyPlugin = config.plugins.find((plugin: { constructor: { name: string } }) => {
    return plugin.constructor.name.includes("Copy");
  });
  assert.ok(copyPlugin, "assets must be copied into the build");
});
