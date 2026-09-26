import path from "node:path";
import { createRequire } from "node:module";
import { rspack } from "@rspack/core";

const require = createRequire(import.meta.url);

// Two copies of @preact/signals-core mean two tracking contexts: a signal
// written by the model would be invisible to useSignals and the DOM would
// never update. Whether yarn hoists one copy or several depends on what the
// rest of the monorepo pins, so the bundle does not rely on it: every import
// is pointed at the copy @preact/signals-react resolves. Neither package
// exports its package.json, so the directory is taken from the entry file.
const packageDirectory = (resolve, name) => {
  return path.resolve(path.dirname(resolve(name)), "..");
};

const signalsReact = packageDirectory(require.resolve, "@preact/signals-react");
const signalsCore = packageDirectory(
  createRequire(path.join(signalsReact, "package.json")).resolve,
  "@preact/signals-core",
);

export default {
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
    alias: {
      "@preact/signals-core": signalsCore,
    },
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
    ],
  },
  plugins: [
    new rspack.HtmlRspackPlugin({
      template: "./index.html",
      filename: "index.html",
      chunks: ["main"],
    }),
  ],
  devServer: {
    hot: true,
    // Free port picked by the OS: a fixed port lets a forgotten server from an
    // earlier run answer with a stale bundle.
    port: 0,
  },
};
