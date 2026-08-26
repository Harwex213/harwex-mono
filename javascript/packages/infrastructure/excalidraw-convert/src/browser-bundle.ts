import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const require = createRequire(import.meta.url);

const entryPath = resolve(dirname(new URL(import.meta.url).pathname), "browser/entry.js");

let bundlePromise: Promise<string> | undefined;

/*
 * `@excalidraw/excalidraw` ships an ESM bundle with bare imports (react, roughjs,
 * jotai, ...), so the browser cannot load it directly. esbuild flattens it into a
 * single IIFE. The result is cached for the lifetime of the process — one build
 * costs about a second, and a batch render should pay it once.
 */
function buildBrowserBundle(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = build({
      entryPoints: [entryPath],
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: "chrome120",
      /*
       * The package `exports` map gates its entry behind `production` /
       * `development`; without the condition esbuild cannot resolve it.
       */
      conditions: ["production"],
      define: {
        "process.env.NODE_ENV": "\"production\"",
        "process.env.IS_PREACT": "\"false\"",
      },
      loader: {
        ".woff2": "dataurl",
        ".ttf": "dataurl",
      },
      logLevel: "silent",
    }).then((result) => {
      const output = result.outputFiles[0];
      if (!output) {
        throw new Error("esbuild produced no output for the Excalidraw browser bundle");
      }
      return output.text;
    });
  }
  return bundlePromise;
}

/*
 * Excalidraw loads its hand-drawn fonts at runtime from `EXCALIDRAW_ASSET_PATH`.
 * The renderer serves this directory, so the page never reaches a CDN.
 */
function resolveAssetRoot(): string {
  const entry = require.resolve("@excalidraw/excalidraw");
  return dirname(entry);
}

export { buildBrowserBundle, resolveAssetRoot };
