import { rspack } from "@rspack/core";

const PORT = Number(process.env.IMAGEN_WEB_PORT ?? 5761);

export default {
  entry: {
    main: "./src/main.tsx",
  },
  output: {
    path: new URL("dist/renderer", import.meta.url).pathname,
    filename: "[name].[contenthash].js",
    cssFilename: "[name].[contenthash].css",
    // The built page is opened over file://, so every asset has to be relative.
    publicPath: "",
    clean: true,
  },
  resolve: {
    extensions: ["...", ".ts", ".tsx"],
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
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
    }),
  ],
  devServer: {
    hot: true,
    port: PORT,
    host: "127.0.0.1",
  },
};
