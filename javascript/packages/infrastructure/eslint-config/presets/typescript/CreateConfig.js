import typescriptPlugin from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import stylisticTs from "@stylistic/eslint-plugin-ts";
import path from "node:path";

const createTypescriptConfig = (rules, tsConfigRootDir) => ({
  files: ["**/*.ts", "**/*.tsx"],
  languageOptions: {
    parser: typescriptParser,
    parserOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      project: tsConfigRootDir ? path.join(tsConfigRootDir, "tsconfig.json") : undefined,
      ecmaFeatures: {
        jsx: true,
      },
      tsconfigRootDir: tsConfigRootDir ? path.join(tsConfigRootDir, "tsconfig.json") : undefined,
    },
  },
  plugins: {
    "@typescript-eslint": typescriptPlugin,
    "@stylistic/ts": stylisticTs,
  },
  rules,
});

export { createTypescriptConfig };
