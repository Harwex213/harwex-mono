import { createCommonConfig } from "./presets/common/CreateConfig.js";
import { createTypescriptConfig } from "./presets/typescript/CreateConfig.js";
// import { createReactConfig } from "./presets/react/CreateConfig.js";
import { baseTypescriptRules } from "./presets/typescript/BaseRules.js";

/**
 *
 * @param {Object} params
 * @param {boolean} [params.typescript]
 * @param {boolean} [params.react]
 * @param {string} [params.pathToTsConfigDir]
 * @param {string[]} [params.ignores]
 * @param {Object[]} [params.overrides]
 *
 * @returns {Array}
 */
const createEslintConfig = (params) => {
    const {
        typescript = false,
        // react = false,
        pathToTsConfigDir = null,
        ignores,
        overrides,
    } = params;

    const config = [
        createCommonConfig(),
    ];

    if (ignores !== undefined) {
        config.unshift({ ignores });
    }

    if (typescript) {
        if (pathToTsConfigDir === null) {
            throw new Error("pathToTsConfigDir is null, but typescript option is enabled");
        }

        config.push(
            createTypescriptConfig(baseTypescriptRules, pathToTsConfigDir),
        )
    }

    // if (react) {
    //     config.push(
    //         createReactConfig(),
    //     )
    // }

    if (overrides !== undefined) {
        config.push(...overrides.map(
            (it) => ({
                ...createTypescriptConfig(baseTypescriptRules, pathToTsConfigDir),
                ...it
            }),
        ));
    }

    return config;
}

export { createEslintConfig };
