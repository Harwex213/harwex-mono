import { rspack } from "@rspack/core";

export default {
  entry: {
    main: "./src/main.tsx",
  },
  output: {
    // Content hashes in the names, because nginx serves js and css with
    // `immutable` for a year. Under a fixed `main.js` the browser and the CDN
    // keep the bundle from the previous deploy and never ask for the new one.
    filename: "[name].[contenthash].js",
    cssFilename: "[name].[contenthash].css",
    // Every build leaves a new set of hashed names behind, so without this the
    // directory keeps every bundle and asset ever built and the image grows.
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
      // Unit portraits. Emitted as files rather than inlined: they are 1:1
      // renders of about a megabyte each, and a data URI that size would land
      // in the JS bundle.
      {
        test: /\.png$/i,
        type: "asset/resource",
      },
      // Sound effects. Emitted as files for the same reason: a clip inlined as a
      // data URI is carried by the bundle on every load, and no sound plays
      // before the page has taken a click.
      {
        test: /\.mp3$/i,
        type: "asset/resource",
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
