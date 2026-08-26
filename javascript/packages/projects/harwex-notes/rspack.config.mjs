import { rspack } from "@rspack/core";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);

const API_PORT = process.env.NOTES_API_PORT ?? 5788;

// `@excalidraw/excalidraw` resolves to `dist/prod/index.js`, and its woff2 files
// sit next to it. Copying them into the bundle and pointing
// `EXCALIDRAW_ASSET_PATH` at the output root is what stops the app fetching
// fonts from unpkg at runtime.
const excalidrawFonts = path.join(
  path.dirname(require.resolve("@excalidraw/excalidraw")),
  "fonts",
);

export default {
  entry: {
    main: "./src/main.tsx",
  },
  output: {
    filename: "[name].[contenthash].js",
    cssFilename: "[name].[contenthash].css",
    publicPath: "/",
    clean: true,
  },
  resolve: {
    extensions: ["...", ".ts", ".tsx"],
    extensionAlias: {
      ".ts": [".ts", ".js"],
    },
    // Excalidraw maps `./index.css` to `production` and `development` only,
    // with no `default`, so the import fails under rspack's stock conditions.
    conditionNames: ["...", "production"],
  },
  module: {
    parser: {
      "css/auto": {
        namedExports: false,
      },
    },
    generator: {
      "css/auto": {
        exportsConvention: "camel-case-only",
      },
    },
    rules: [
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
              },
            },
          },
        },
        type: "javascript/auto",
      },
      {
        test: /\.css$/i,
        type: "css/auto",
      },
      {
        // Excalidraw's dist is ESM, so rspack requires fully specified
        // requests inside it, yet it imports `roughjs/bin/rough` with no
        // extension. Relaxing the rule for dependency JS is the only way past
        // that; this package's own sources are TypeScript and unaffected.
        test: /\.m?js$/,
        include: /node_modules/,
        resolve: {
          fullySpecified: false,
        },
      },
    ],
  },
  plugins: [
    new rspack.HtmlRspackPlugin({
      template: "./index.html",
    }),
    new rspack.CopyRspackPlugin({
      patterns: [
        {
          from: excalidrawFonts,
          to: "fonts",
        },
      ],
    }),
  ],
  devServer: {
    // Full reload, not HMR: nothing here accepts a hot update, and both
    // Excalidraw and CodeMirror hold state that a partial update would strand.
    hot: false,
    liveReload: true,
    // Free port picked by the OS, as everywhere else in the repo, so a
    // forgotten server from an earlier run cannot answer with a stale bundle.
    port: 0,
    proxy: [
      {
        context: ["/trpc"],
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: false,
      },
    ],
  },
};
