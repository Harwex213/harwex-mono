import { rspack } from "@rspack/core";

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
    // Copied, not imported. `map.png` is 2.6 MB and `provinces_map.png` 566 KB;
    // an `asset/resource` import would hash the filenames for no benefit here,
    // and an inlined data URL would be catastrophic. Copying keeps
    // `assets/<name>` as one stable URL that `devServer.static` already answers
    // in dev. `noErrorOnMissing` stays at its default false, so a missing
    // `assets/` fails the build instead of shipping a broken app.
    new rspack.CopyRspackPlugin({
      patterns: [
        {
          from: "assets",
          to: "assets",
        },
      ],
    }),
  ],
  devServer: {
    hot: true,
    // Free port picked by the OS, as everywhere else in the repo: a fixed port
    // lets a forgotten server from an earlier run answer with a stale bundle.
    port: 0,
    // The map assets are served, not bundled. T02 decides how the production
    // build gets them; until then dev can read them from `/assets/...`.
    static: {
      directory: "./assets",
      publicPath: "/assets",
    },
  },
};
