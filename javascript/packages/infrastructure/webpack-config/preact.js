import { createBaseConfig } from "./index.js";

export const createPreactConfig = (options = {}) => {
    const baseConfig = createBaseConfig({
        entry: "./src/index.tsx",
        ...options
    });

    return {
        ...baseConfig,
        resolve: {
            ...baseConfig.resolve,
            alias: {
                ...baseConfig.resolve.alias,
                "react": "preact/compat",
                "react-dom/test-utils": "preact/test-utils",
                "react-dom": "preact/compat",
                "react/jsx-runtime": "preact/jsx-runtime"
            }
        }
    };
};