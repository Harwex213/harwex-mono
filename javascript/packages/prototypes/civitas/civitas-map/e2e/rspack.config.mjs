import { fileURLToPath } from "node:url";
import base from "../rspack.config.mjs";

// The app config, built in production mode into `e2e/dist/app` instead of `dist/`.
// The entry is the real `src/main.tsx`: the tests mock the backend at the network
// level, so the bundle needs no test hooks.
const packageRoot = fileURLToPath(new URL("../", import.meta.url));

export default {
  ...base,
  context: packageRoot,
  mode: "production",
  output: {
    ...base.output,
    path: fileURLToPath(new URL("./dist/app/", import.meta.url)),
  },
  devServer: undefined,
};
