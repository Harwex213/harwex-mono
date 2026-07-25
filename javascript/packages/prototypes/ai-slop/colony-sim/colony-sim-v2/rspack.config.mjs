import path from "node:path";
import { fileURLToPath } from "node:url";
import { rspack } from "@rspack/core";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  entry: {
    main: "./src/index.tsx",
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    alias: {
      "@": path.resolve(dirname, "src"),
      // Sprite sheets live one level up, shared with colony-sim-v1.
      "@assets": path.resolve(dirname, "../assets"),
      "react": "preact/compat",
      "react-dom/test-utils": "preact/test-utils",
      "react-dom": "preact/compat",
      "react/jsx-runtime": "preact/jsx-runtime",
    },
  },
  module: {
    rules: [
      {
        test: /\.css$/i,
        type: "css/auto",
      },
      {
        test: /\.(png|jpe?g|webp)$/i,
        type: "asset/resource",
      },
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
    ],
  },
  plugins: [
    new rspack.HtmlRspackPlugin({
      template: "./index.html",
    }),
  ],
  devServer: {
    hot: true,
  },
};
