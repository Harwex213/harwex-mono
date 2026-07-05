import { defineConfig } from "@rsbuild/core";

export default defineConfig({
    html: {
        template: "./index.html",
    },
    output: {
        cssModules: {
            exportLocalsConvention: "camelCaseOnly",
        },
    },
});
