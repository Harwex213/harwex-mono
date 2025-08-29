import path from "node:path";
import { fileURLToPath } from "url";
import { createEslintConfig } from "@hw/eslint-config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default createEslintConfig({
    typescript: true,
    pathToTsConfigDir: __dirname,
    ignores: [
        "**/*.spec.ts",
        "**/*.test.ts",
        "**/*.d.ts",
        "**/*.js",
        "**/*.cjs",
        "**/*.mjs"
    ],
    overrides: []
});
