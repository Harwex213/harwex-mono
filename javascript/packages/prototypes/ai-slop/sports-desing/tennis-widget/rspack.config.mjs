import { rspack } from "@rspack/core";

export default {
  entry: "./src/main.tsx",
  output: {
    filename: "[name].[contenthash].js",
    cssFilename: "[name].[contenthash].css",
    publicPath: "",
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
        // The default dev ident is "\@hw\/<pkg>-src_<file>_module_css-<name>". Inside a
        // grid-template-areas string that escaped name is invalid and the browser drops the rule.
        localIdentName: "[local]_[hash:6]",
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
      {
        test: /\.(png|jpe?g|webp)$/i,
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
    // Free port picked by the OS: a fixed port lets a forgotten server answer with a stale bundle.
    port: 0,
  },
};
