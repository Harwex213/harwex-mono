import { defineConfig } from "@rslib/core"

export default defineConfig({
  source: {
    tsconfigPath: "./tsconfig.build.json",
    entry: {
      index: [
        "./src/**",
        "!./src/demo/**",
        "!./src/**/demo.tsx",
        "!./src/env.d.ts",
      ],
    },
  },
  lib: [
    {
      format: "esm",
      bundle: false,
      dts: true,
    },
  ],
  output: {
    target: "web",
    cssModules: {
      exportLocalsConvention: "camelCaseOnly",
    },
  },
})
