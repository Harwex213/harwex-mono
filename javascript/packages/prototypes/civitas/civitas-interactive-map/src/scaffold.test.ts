import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

// Pins the package contract: manifest, build config and TS config values the code depends on.

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
  // `defaultSemverRangePrefix: ""` covers only `yarn add`; a hand-written range
  // would drift from `../civitas-map`.
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
  // 2.1.0 on purpose, not 2.1.4.
  assert.equal(devDependencies["@rspack/dev-server"], "2.1.0");
  assert.equal(devDependencies.typescript, "5.9.3");
  assert.equal(devDependencies.tsx, "4.19.4");
});

test("the test script keeps its quoted glob so the shell cannot expand it", () => {
  // An unquoted glob makes the runner error instead of matching files.
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

  // Standalone: no `@hw/typescript-config` and no path aliases.
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
  // Without env.d.ts, `styles` imports lose their type.
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
  // Without id="root" React cannot mount; without class="root" the map has zero height.
  const html = readPackageFile("index.html");

  assert.match(html, /id="root"/);
  assert.match(html, /class="root"/);

  const css = readPackageFile("src/index.css");
  assert.match(css, /\.root/);
});

test("no source file imports a map asset into the bundle", () => {
  // An asset import would add 2.6 MB to dist and still pass the build.
  const sources = collectSourceFiles(packageRoot + "src", []);
  assert.ok(sources.length > 0, "src must contain source files");

  for (const file of sources) {
    const body = readFileSync(file, "utf8");
    assert.doesNotMatch(body, /from\s+"[^"]*\/assets\//, file + " imports from assets/");
    assert.doesNotMatch(body, /import\s+"[^"]*\.(png|jpg)"/, file + " imports an image");
  }
});

test("source files obey the grouped-named-export convention", () => {
  // One grouped named export at the end, per javascript/CLAUDE.md.
  // Ambient .d.ts files are exempt: `declare module` needs `export default`.
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
  // Imported, not string-matched, so formatting does not matter.
  // A computed specifier keeps this .mjs out of the `tsc` program.
  const configUrl = new URL("../rspack.config.mjs", import.meta.url).href;
  const loaded = await import(configUrl);
  const config = loaded.default;

  assert.equal(config.entry.main, "./src/main.tsx");
  assert.equal(config.output.clean, true);
  assert.deepEqual(config.resolve.extensions, ["...", ".ts", ".tsx"]);

  // Both are needed for a default `styles` object with camelCased keys.
  assert.equal(config.module.parser["css/auto"].namedExports, false);
  assert.equal(config.module.generator["css/auto"].exportsConvention, "camel-case-only");

  const tsRule = config.module.rules.find((rule: { test: RegExp }) => {
    return rule.test.source === /\.tsx?$/.source;
  });
  assert.ok(tsRule, "a rule for .ts/.tsx must exist");
  assert.equal(tsRule.loader, "builtin:swc-loader");
  assert.equal(tsRule.options.jsc.transform.react.runtime, "automatic");
  assert.equal(tsRule.options.jsc.parser.tsx, true);
  // Without it rspack treats the module as strict ESM and the JSX runtime import breaks.
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

  // Assets are copied, never imported.
  assert.equal(config.plugins.length, 2);
  const copyPlugin = config.plugins.find((plugin: { constructor: { name: string } }) => {
    return plugin.constructor.name.includes("Copy");
  });
  assert.ok(copyPlugin, "assets must be copied into the build");
});
