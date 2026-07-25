import { rspack } from "@rspack/core";
import { moduleRules, resolve } from "../rspack.shared.mjs";

export default {
  entry: {
    main: "./src/main.ts",
  },
  resolve,
  module: moduleRules,
  plugins: [
    new rspack.HtmlRspackPlugin({
      template: "./index.html",
    }),
  ],
  devServer: {
    hot: true,
    port: 5150,
  },
};
