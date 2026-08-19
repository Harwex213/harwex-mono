import { rspack } from "@rspack/core";

// The dev server port is fixed, because `playwright.config.ts` points its
// `webServer` at it. A random port (`0`) would leave the screenshot tests with
// no address to open.
const DEV_SERVER_PORT = 8130;

export default {
  entry: {
    // The app a human opens.
    main: "./src/main.tsx",
    // The screenshot harness: same UI, but the store is seeded by a named
    // scenario instead of by the app entry.
    harness: "./src/harness.tsx",
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
      template: "./index.html",
      filename: "index.html",
      chunks: ["main"],
    }),
    new rspack.HtmlRspackPlugin({
      template: "./harness.html",
      filename: "harness.html",
      chunks: ["harness"],
    }),
  ],
  devServer: {
    hot: true,
    port: DEV_SERVER_PORT,
  },
};
