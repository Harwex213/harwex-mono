import importPlugin from "eslint-plugin-import";
import stylisticJs from "@stylistic/eslint-plugin-js";
import { baseCommonRules } from "./BaseRules.js";

const createCommonConfig = () => {
  return {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        Atomics: "readonly",
        SharedArrayBuffer: "readonly",
      },
    },
    plugins: {
      import: importPlugin,
      "@stylistic/js": stylisticJs,
    },
    settings: {
      "import/resolver": {
        node: {
          extensions: [".js", ".ts", ".tsx"],
        },
      },
    },
    rules: baseCommonRules,
  }
}

export { createCommonConfig }
