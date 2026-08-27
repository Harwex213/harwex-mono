import { createRequire } from "node:module";
import path from "node:path";
import { rspack } from "@rspack/core";

// Each worktree that runs the playground at the same time needs its own port:
// `PORT=8151 yarn dev`.
const DEFAULT_DEV_SERVER_PORT = 8150;

const require = createRequire(import.meta.url);

// Excalidraw loads its hand-drawn fonts over the network at runtime, from
// `window.EXCALIDRAW_ASSET_PATH`. Copying them into the bundle keeps the playground off the
// CDN. The fonts sit next to the dist entry, which is the only path the package exports.
const excalidrawFontsDir = path.join(
  path.dirname(require.resolve("@excalidraw/excalidraw")),
  "fonts"
);

// Excalidraw builds those font URLs while its module is evaluated, so the path has to be set
// before the bundle runs. It goes in ahead of the entry rather than in `dev/index.html`,
// which is shared by every component branch.
const EXCALIDRAW_ASSET_PATH_BANNER = 'window.EXCALIDRAW_ASSET_PATH = "/";';

// The playground bundles `dev/`, never `exports.ts`. The library itself is source-only and
// is compiled by the consumer's bundler (`@hw/harwex-notes`).
export default () => ({
  entry: {
    main: "./dev/main.tsx",
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
    new rspack.HtmlRspackPlugin({
      template: "./dev/index.html",
      filename: "index.html",
      chunks: ["main"],
    }),
    new rspack.BannerPlugin({
      banner: EXCALIDRAW_ASSET_PATH_BANNER,
      raw: true,
      entryOnly: true,
      test: /\.js$/,
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
    port: Number(process.env.PORT ?? DEFAULT_DEV_SERVER_PORT),
  },
});
