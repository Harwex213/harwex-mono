import { rspack } from "@rspack/core";

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
    new rspack.HtmlRspackPlugin({
      template: "./harness/index.html",
      filename: "index.html",
      chunks: ["harness"],
    }),
  ],
  devServer: {
    hot: true,
    // Free port picked by the OS: a fixed port lets a forgotten server from an
    // earlier run answer with a stale bundle.
    port: 0,
  },
};
