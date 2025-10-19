import { readdir } from 'node:fs/promises';

const tests = [];

tests.push(
  async function readTestSubject() {
    try {
      const path = "./_test-subject";
      const files = await readdir(path, { withFileTypes: true });
      for (const file of files)
        console.log("readTestSubject", file.name, file.isDirectory());
    } catch (err) {
      console.error("readTestSubject:error", err);
    }
  }
);

tests.push(
  async function readWrongTestSubject() {
    try {
      const path = "./_test-subject/somefile.txt";
      const files = await readdir(path);
      for (const file of files)
        console.log("readWrongTestSubject", file);
    } catch (err) {
      console.error("readWrongTestSubject:error", err);
    }
  }
);

(async function main() {
  for (const test of tests) {
    await test();
    console.log("-----------------------------------------")
  }
})();
