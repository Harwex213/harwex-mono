import { lstat, stat } from "node:fs/promises";
import { fstatSync, openSync } from "node:fs";

(async () => {
  const examinedPath = "./_test-subject/somefile.txt";

  const fsStats = await stat(examinedPath);
  console.log(fsStats.isDirectory());

  /**
   * same stats object, but if examinedPath is symbolic link, `lstat()` will take info about
   * examined symbolic link rather about actual file
   */
  const fsLStats = await lstat(examinedPath);
  console.log(fsLStats.isDirectory());

  const openedFile = openSync(examinedPath, "r");
  /**
   * fstat should be used if file already is opened
   */
  const fsFStats = fstatSync(openedFile);
  console.log(fsFStats.isDirectory());
})()