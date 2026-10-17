import { createRequire } from "node:module";
import path from "node:path";
import { rspack } from "@rspack/core";

const DEV_SERVER_PORT = 8140;
// The app calls the api on its own origin. The backend serves the built app, and in
// development the dev server forwards `/api` to the backend, so the browser never makes a
// cross-origin call. The backend refuses those (see origin-guard.ts in the backend).
const DEFAULT_API_URL = "/api";
const API_ROUTE_PREFIX = "/api";
// Where the dev server forwards `/api`. Override with `BACKEND_URL=http://localhost:4002`.
const DEFAULT_BACKEND_URL = "http://localhost:4001";

const require = createRequire(import.meta.url);

// Excalidraw loads its hand-drawn fonts over the network at runtime, from
// `window.EXCALIDRAW_ASSET_PATH`. Copying them into the bundle keeps the app off the CDN.
// The fonts sit next to the dist entry, which is the only path the package exports.
const excalidrawFontsDir = path.join(
  path.dirname(require.resolve("@excalidraw/excalidraw")),
  "fonts"
);

// `rspack serve --env mocked` runs the app on the in-memory api instead of the backend.
export default (env = {}) => ({
  entry: {
    main: "./src/main.tsx",
  },
  output: {
    filename: "[name].[contenthash].js",
    cssFilename: "[name].[contenthash].css",
    clean: true,
  },
  resolve: {
    extensions: ["...", ".ts", ".tsx"],
    // The protocol package is source-only and written for Node resolution, so its relative
    // imports say `.js` while the files on disk are `.ts`.
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
    // `@excalidraw/excalidraw` exports its stylesheet under `development` and `production`
    // only, with no `default`, so the import fails to resolve without one of the two.
    conditionNames: ["...", "production"],
  },
  module: {
    parser: {
      "css/auto": {
        namedExports: false,
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
        // The Excalidraw dist imports `roughjs/bin/rough` with no extension, which an ESM
        // module may not do. Published packages are the only place this is tolerated.
        test: /\.m?js$/,
        include: /node_modules/,
        resolve: {
          fullySpecified: false,
        },
      },
    ],
  },
  plugins: [
    new rspack.DefinePlugin({
      __API_MOCKED__: JSON.stringify(Boolean(env.mocked)),
      __API_URL__: JSON.stringify(process.env.API_URL ?? DEFAULT_API_URL),
    }),
    new rspack.HtmlRspackPlugin({
      template: "./index.html",
      filename: "index.html",
      chunks: ["main"],
    }),
    new rspack.CopyRspackPlugin({
      patterns: [
        {
          from: excalidrawFontsDir,
          to: "fonts",
        },
      ],
    }),
  ],
  devServer: {
    hot: true,
    port: DEV_SERVER_PORT,
    // An HTML page runs in a sandboxed frame with an origin of its own, so the browser marks
    // its stylesheet, image and script requests as cross-site. The dev server refuses such
    // requests unless the host is listed here.
    allowedHosts: ["localhost", "127.0.0.1"],
    proxy: [
      {
        // tRPC calls, images and HTML pages (`/api/raw/...`). The Host header is kept as
        // the browser sent it, so the backend sees the request as same-origin.
        context: [API_ROUTE_PREFIX],
        target: process.env.BACKEND_URL ?? DEFAULT_BACKEND_URL,
        changeOrigin: false,
      },
    ],
  },
});
