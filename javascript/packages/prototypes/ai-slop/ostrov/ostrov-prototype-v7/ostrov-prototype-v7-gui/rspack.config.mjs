import { rspack } from "@rspack/core";

export default {
  entry: {
    harness: "./harness/main.tsx",
  },
  output: {
    filename: "[name].[contenthash].js",
    cssFilename: "[name].[contenthash].css",
    clean: true,
  },
  resolve: {
    extensions: ["...", ".ts", ".tsx"],
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
