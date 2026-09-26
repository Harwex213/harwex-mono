import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rspack } from "@rspack/core";
import { write } from "./tools/extract-model.mjs";

const root = dirname(fileURLToPath(import.meta.url));

// The diagram is generated from the sources, not written by hand. The model is
// rebuilt before every compile, and a change under src/ triggers one.
class ModelPlugin {
  apply(compiler) {
    compiler.hooks.beforeCompile.tap("ostrov-core-model", () => {
      write();
    });

    compiler.hooks.afterCompile.tap("ostrov-core-model", (compilation) => {
      compilation.contextDependencies.add(join(root, "src"));
    });
  }
}

export default {
  entry: {
    harness: "./harness/main.ts",
  },
  output: {
    filename: "[name].[contenthash].js",
    clean: true,
  },
  resolve: {
    extensions: ["...", ".ts"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: "builtin:swc-loader",
        options: {
          jsc: {
            parser: {
              syntax: "typescript",
            },
          },
        },
        type: "javascript/auto",
      },
    ],
  },
  plugins: [
    new ModelPlugin(),
    new rspack.HtmlRspackPlugin({
      template: "./harness/index.html",
      filename: "index.html",
      chunks: ["harness"],
    }),
  ],
  // The model is a build input that every compile rewrites. Watching it would
  // make the compile trigger the next one, so the watcher ignores the file. A
  // change under src/ still rebuilds: the plugin adds that directory above.
  watchOptions: {
    ignored: ["**/harness/model.generated.json", "**/node_modules/**", "**/dist/**"],
  },
  devServer: {
    hot: true,
    // Free port picked by the OS: a fixed port lets a forgotten server from an
    // earlier run answer with a stale bundle.
    port: 0,
  },
};
