import { rspack } from "@rspack/core";
import { devServer, moduleRules, resolve } from "../rspack.shared.mjs";

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
  devServer,
};
