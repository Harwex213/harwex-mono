import { fileURLToPath } from "node:url";
import { rspack } from "@rspack/core";
import { createMapsApiMiddleware } from "./dev-server/maps-api.mjs";

const mapsDirectory = fileURLToPath(new URL("./assets/maps/", import.meta.url));

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
    generator: {
      "css/auto": {
        exportsConvention: "camel-case-only",
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
    // Free port picked by the OS, as everywhere else in the repo: a fixed port
    // lets a forgotten server from an earlier run answer with a stale bundle.
    port: 0,
    static: {
      // The images in `assets/maps/` are served but never bundled: they run to
      // tens of megabytes. The app lists them through `/api/maps` and fetches the
      // one the operator picks from `/assets/maps/<name>`.
      directory: "./assets",
      publicPath: "/assets",
    },
    // A stand-in for the backend: `GET /api/maps` lists `assets/maps/`. The
    // contract is documented in `dev-server/maps-api.mjs`.
    setupMiddlewares: (middlewares) => {
      middlewares.unshift({
        name: "maps-api",
        path: "/api/maps",
        middleware: createMapsApiMiddleware({
          directory: mapsDirectory,
          urlPrefix: "assets/maps/",
        }),
      });
      return middlewares;
    },
  },
};
