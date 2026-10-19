import { fileURLToPath } from "node:url";
import base from "../rspack.config.mjs";

// The app config with the entry `e2e/main.tsx`. Output goes to `e2e/dist/app`, not `dist/`.
const packageRoot = fileURLToPath(new URL("../", import.meta.url));

export default {
  ...base,
  context: packageRoot,
  mode: "production",
  entry: {
    main: "./e2e/main.tsx",
  },
  output: {
    ...base.output,
    path: fileURLToPath(new URL("./dist/app/", import.meta.url)),
  },
  devServer: undefined,
};
