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
  ],
  // `@hw/ostrov-prototype-v2-config` is a workspace package, so yarn drops a
  // symlink into node_modules and rspack treats everything under it as a
  // managed, immutable dependency: edits to the config would never be noticed.
  // Clearing `managedPaths` puts the linked sources back under normal watching.
  snapshot: {
    managedPaths: [],
  },
  watchOptions: {
    ignored: /node_modules[\\/](?!@hw[\\/])/,
  },
  devServer: {
    // Full reload, not HMR. Nothing here accepts a hot update, and a partial
    // one is worse than none: constants read at draw time would pick up the new
    // config while snapshots taken at module init (`TERRAIN_STYLES`) would not,
    // so the picture would end up half old and half new.
    hot: false,
    liveReload: true,
    // Free port picked by the OS, as everywhere else in the repo: a fixed port
    // lets a forgotten server from an earlier run answer with a stale bundle.
    port: 0,
  },
};
