import { readFileSync, writeFileSync } from "fs";

/**
 * @param firstJson
 *      json со структурой типа `"key": string value`
 * @param secondJson
 *      json со структурой типа `"key": string value`
 */
const getJsonUnion = (firstJson, secondJson) => {
    const union = {};

    for (const key in firstJson) {
        union[key] = firstJson[key];
    }

    for (const key in secondJson) {
        union[key] = secondJson[key];
    }

    return union;
}

const readJson = (path) => JSON.parse(readFileSync(path).toString());

const saveJson = (path, json) => writeFileSync(path, JSON.stringify(json, null, 2));

(() => {
    const firstJson = readJson("./input/first-json.json");
    const secondJson = readJson("./input/second-json.json");

    const jsonUnion = getJsonUnion(firstJson, secondJson);

    saveJson("./output/union-json.json", jsonUnion);
})();
