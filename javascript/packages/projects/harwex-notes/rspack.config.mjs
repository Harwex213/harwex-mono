import { rspack } from "@rspack/core";

const DEV_SERVER_PORT = 8140;

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
    port: DEV_SERVER_PORT,
  },
};
