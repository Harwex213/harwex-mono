import { readFileSync } from "fs";
import { unlink } from "fs/promises";

const getFilesToDelete = (path) => {
    const files = readFileSync(path).toString();

    return files.split("\n").filter((line) => line !== "");
}

(async () => {
    const files = getFilesToDelete("./input/files-to-delete.txt");

    await Promise.all(files.map((file) => {
        console.log(`Start deleting file '${file}'`);
        return unlink(file);
    }));
})();
