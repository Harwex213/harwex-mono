import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

async function traverseDir(path, level = 0) {
  if ((await lstat(path)).isDirectory() === false) {
    console.log("traverse file", level, path);
    return;
  }

  console.log("traverse directory", level, path);

  const files = await readdir(path, { withFileTypes: true });
  for (const file of files) {
    const filePath = join(file.parentPath, file.name);

    if (file.isDirectory()) {
      traverseDir(filePath, level + 1);

      continue;
    }

    console.log("traverse file", level, filePath);
  }
}

(async function main() {
  const initPath = "./_test-subject";

  await traverseDir(initPath);
})();
