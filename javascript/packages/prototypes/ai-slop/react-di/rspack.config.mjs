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
    ],
  },
  plugins: [
    new rspack.HtmlRspackPlugin(),
  ],
  devServer: {
    hot: true,
    port: 0,
  },
};
