import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { relPathSchema } from "../shared/contract.ts";
import { listDirectory, readTextFile, resolveInRoot, writeTextFile } from "./workspace.ts";

let root = "";
let outside = "";

before(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "harwex-notes-test-"));
  root = path.join(base, "root");
  outside = path.join(base, "outside");
  await fs.mkdir(path.join(root, "nested"), { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(root, "note.txt"), "inside\n", "utf8");
  await fs.writeFile(path.join(root, "nested", "deep.md"), "# deep\n", "utf8");
  await fs.writeFile(path.join(outside, "secret.txt"), "outside\n", "utf8");
  await fs.symlink(outside, path.join(root, "escape"), "dir");
  await fs.symlink(path.join(root, "nested"), path.join(root, "inward"), "dir");
});

after(async () => {
  if (root.length > 0) {
    await fs.rm(path.dirname(root), { recursive: true, force: true });
  }
});

async function expectForbidden(relPath: string): Promise<void> {
  await assert.rejects(
    () => {
      return resolveInRoot(root, relPath);
    },
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "FORBIDDEN");
      return true;
    },
    `${relPath} should have been refused`,
  );
}

test("the schema refuses paths that could escape before the server sees them", () => {
  assert.equal(relPathSchema.safeParse("nested/deep.md").success, true);
  assert.equal(relPathSchema.safeParse("").success, true);
  assert.equal(relPathSchema.safeParse("../secret.txt").success, false);
  assert.equal(relPathSchema.safeParse("nested/../../secret.txt").success, false);
  assert.equal(relPathSchema.safeParse("/etc/passwd").success, false);
  assert.equal(relPathSchema.safeParse("note\0.txt").success, false);
});

test("resolveInRoot accepts paths inside the root", async () => {
  assert.equal(await resolveInRoot(root, ""), root);
  assert.equal(await resolveInRoot(root, "note.txt"), path.join(root, "note.txt"));
  assert.equal(
    await resolveInRoot(root, "nested/deep.md"),
    path.join(root, "nested", "deep.md"),
  );
});

test("resolveInRoot accepts a file that does not exist yet", async () => {
  assert.equal(
    await resolveInRoot(root, "nested/brand-new.md"),
    path.join(root, "nested", "brand-new.md"),
  );
});

test("resolveInRoot refuses a `..` traversal", async () => {
  await expectForbidden("../secret.txt");
  await expectForbidden("nested/../../outside/secret.txt");
});

test("resolveInRoot refuses an absolute path", async () => {
  await expectForbidden(path.join(outside, "secret.txt"));
  await expectForbidden("/etc/passwd");
});

test("resolveInRoot refuses a symlink pointing out of the root", async () => {
  await expectForbidden("escape");
  await expectForbidden("escape/secret.txt");
  await expectForbidden("escape/not-created-yet.txt");
});

test("resolveInRoot accepts a symlink pointing back inside the root", async () => {
  assert.equal(await resolveInRoot(root, "inward/deep.md"), path.join(root, "inward", "deep.md"));
});

test("listDirectory sorts directories first, then files, case-insensitively", async () => {
  const { entries } = await listDirectory(root, "");
  const shape = entries.map((entry) => {
    return `${entry.type}:${entry.name}`;
  });
  assert.deepEqual(shape, ["dir:escape", "dir:inward", "dir:nested", "file:note.txt"]);
  const nested = entries.find((entry) => {
    return entry.name === "nested";
  });
  assert.equal(nested?.fileKind, null);
});

test("readTextFile reports the file kind and refuses binary content", async () => {
  const read = await readTextFile(root, "nested/deep.md");
  assert.equal(read.fileKind, "markdown");
  assert.equal(read.text, "# deep\n");
  await fs.writeFile(path.join(root, "blob.bin"), Buffer.from([1, 0, 2]));
  await assert.rejects(() => {
    return readTextFile(root, "blob.bin");
  });
});

test("writeTextFile rejects a stale write and accepts a fresh one", async () => {
  const read = await readTextFile(root, "note.txt");
  await assert.rejects(
    () => {
      return writeTextFile(root, "note.txt", "stale\n", read.mtimeMs - 5000);
    },
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "CONFLICT");
      return true;
    },
  );
  const written = await writeTextFile(root, "note.txt", "fresh\n", read.mtimeMs);
  assert.equal(typeof written.mtimeMs, "number");
  const after = await readTextFile(root, "note.txt");
  assert.equal(after.text, "fresh\n");
});
