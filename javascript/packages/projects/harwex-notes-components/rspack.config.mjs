import { rspack } from "@rspack/core";

// Each worktree that runs the playground at the same time needs its own port:
// `PORT=8151 yarn dev`.
const DEFAULT_DEV_SERVER_PORT = 8150;

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
      template: "./dev/index.html",
      filename: "index.html",
      chunks: ["main"],
    }),
  ],
  devServer: {
    hot: true,
    port: Number(process.env.PORT ?? DEFAULT_DEV_SERVER_PORT),
  },
});
