import { readFileSync, writeFileSync } from "fs";

/**
 * @param firstJson
 *      json со структурой типа `"key": string value`
 * @param secondJson
 *      json со структурой типа `"key": string value`
 */
const getJsonIntersection = (firstJson, secondJson) => {
    const intersection = {};

    for (const firstJsonKey in firstJson) {
        if (firstJsonKey in secondJson) {
            intersection[firstJsonKey] = firstJson[firstJsonKey];
        }
    }

    return intersection;
}

const readJson = (path) => JSON.parse(readFileSync(path).toString());

const saveJson = (path, json) => writeFileSync(path, JSON.stringify(json, null, 2));

(() => {
    // const argv = process.argv.slice(1);
    // const oldTheme = argv[0];
    // assertNotNil(oldTheme, "work.chore.json-diff.getOldTheme");
    // const newTheme = argv[1];
    // assertNotNil(newTheme, "work.chore.json-diff.getNewTheme");

    const firstJson = readJson("./input/first-json.json");
    const secondJson = readJson("./input/second-json.json");

    const jsonIntersection = getJsonIntersection(firstJson, secondJson);

    saveJson("./output/intersected-json.json", jsonIntersection);
})();
