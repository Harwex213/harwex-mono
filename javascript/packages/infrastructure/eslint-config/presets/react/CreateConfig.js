import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import { baseReactRules } from "./BaseRules.js";

const createReactConfig = () => ({
  files: ["**/*.ts", "**/*.tsx"],
  languageOptions: {
    ecmaVersion: 2023,
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
    react: reactPlugin,
    "react-hooks": reactHooksPlugin,
  },
  settings: {
    react: {
      version: "detect",
    },
  },
  rules: baseReactRules,
});

export { createReactConfig };
