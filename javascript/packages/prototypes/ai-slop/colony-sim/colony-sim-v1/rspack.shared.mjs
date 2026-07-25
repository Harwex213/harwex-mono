import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Every app in this group bundles the same three source packages, so the loader
// rules and the asset alias live here instead of being copy-pasted per app. What
// stays in each app's own config is what actually differs: entry, html, devServer.
const resolve = {
  extensions: [".ts", ".tsx", ".js", ".jsx"],
  alias: {
    // Sprite sheets sit outside the packages — one shared set for v1 and v2 — so
    // game-render reaches them through an alias rather than owning them.
    "@assets": path.resolve(dirname, "../assets"),
  },
};

// The workspace packages are consumed as TypeScript source (no build step), so the
// swc rule must not exclude node_modules: that is where the symlinks to the
// sibling packages live.
const moduleRules = {
  rules: [
    {
      test: /\.css$/i,
      type: "css/auto",
    },
    {
      test: /\.(png|jpe?g|webp)$/i,
      type: "asset/resource",
    },
    {
      test: /\.tsx?$/,
      loader: "builtin:swc-loader",
      options: {
        jsc: {
          parser: {
            syntax: "typescript",
            tsx: true,
          },
          transform: {
            react: {
              runtime: "automatic",
              // HUD components target preact directly, so no react → preact/compat
              // aliasing is needed anywhere in the graph.
              importSource: "preact",
            },
          },
        },
      },
      type: "javascript/auto",
    },
  ],
};

export { moduleRules, resolve };
