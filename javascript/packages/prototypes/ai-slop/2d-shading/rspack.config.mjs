import { rspack } from "@rspack/core";

export default {
  entry: {
    main: "./src/main.ts",
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.css$/i,
        type: "css/auto",
      },
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
      template: "./index.html",
    }),
  ],
  devServer: {
    hot: true,
    // Free port picked by the OS, as everywhere else in the repo: a fixed port
    // lets a forgotten server from an earlier run answer with a stale bundle.
    port: 0,
  },
};
