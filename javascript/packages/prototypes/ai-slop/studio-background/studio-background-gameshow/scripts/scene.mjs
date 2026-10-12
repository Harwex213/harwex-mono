// `yarn scene <command>`: safe edits of the scene versions for agents and scripts.
// Every command reads the version, changes it in memory and saves the change through the same merge as the editor
// Save: under the lock of the versions folder, merged into the file as it is on disk at that moment, written
// atomically. An open editor tab picks the change up at once. Run `yarn scene help` for the commands.
import { readFile } from "node:fs/promises";
import { canonical, clean, diffScene, formatJson } from "../src/engine/sceneMerge.ts";
import { MAX_VERSIONS, createVersion, readIndex, readVersion, resolveVersion, saveChanges, sceneDir } from "./sceneStore.mjs";

const HELP = `yarn scene <command> [--v N] [--dry]

Reads and edits the LATEST version unless --v N names another one. --dry prints the change and writes nothing.
Values are JSON ("[1, 0, 2]", "0.5", "true", "\\"text\\""). A value that is not JSON is taken as a string.

  versions                          list the versions (* marks the latest)
  get <id>                          print the record of an object
  find <text>                       list the objects whose id or name contains the text
  children <id>                     list the children of an object ("" is the root)
  set <id> <field> <value>          set a field: name, parent, order, position, rotation, scale, visible,
                                    flags.<flag>, components.<type>, components.<type>.<key>...
                                    null removes the field
  move <id> <parent> [order]        put an object under another parent (keeps the local transform)
  add <id> <record>                 add an object: a record with at least name, parent, order
  delete <id>                       delete an object and everything under it
  material <name> <field> <value>   set a value of a shared material (color, emissive, roughness, ...)
  setting <key> <value>             set a render setting (toneMappingExposure, bloom, ...)
  patch <file.json | ->             apply a patch: { "objects": { "<id>": partial record | null },
                                    "materials": { "<name>": partial values }, "settings": { ... } }
                                    a partial record merges into the record (components by type);
                                    an id that does not exist needs a full record; null deletes the object
  new-version [label]               copy the latest version into a new latest version
                                    (the oldest version goes when there are more than ${MAX_VERSIONS})
`;

function fail(message) {
  console.error(`scene: ${message}`);
  process.exit(1);
}

// Removes float noise from every number, like the editor does when it saves.
function cleanNumbers(value) {
  if (typeof value === "number") {
    return clean(value);
  }
  if (Array.isArray(value)) {
    return value.map(cleanNumbers);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanNumbers(item)]));
  }
  return value;
}

function parseValue(text) {
  if (text === undefined) {
    fail("a value is missing");
  }
  try {
    return cleanNumbers(JSON.parse(text));
  } catch {
    return text;
  }
}

function parseArgs(argv) {
  const positional = [];
  const options = { version: undefined, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--v" || arg === "--version") {
      options.version = argv[++i];
    } else if (arg.startsWith("--v=")) {
      options.version = arg.slice(4);
    } else if (arg === "--dry") {
      options.dry = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, options };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function need(scene, id) {
  const record = scene.objects[id];
  if (!record) {
    fail(`no object with id ${JSON.stringify(id)}`);
  }
  return record;
}

// Sets `path` (dot-separated keys) inside `target`. null or undefined removes the key; empty objects go too.
function setPath(target, path, value) {
  const [head, ...rest] = path;
  if (rest.length === 0) {
    if (value === null || value === undefined) {
      delete target[head];
    } else {
      target[head] = value;
    }
    return;
  }
  if (target[head] === undefined || target[head] === null || typeof target[head] !== "object") {
    target[head] = {};
  }
  setPath(target[head], rest, value);
  if (Object.keys(target[head]).length === 0) {
    delete target[head];
  }
}

function subtree(scene, id) {
  const result = [id];
  for (let i = 0; i < result.length; i++) {
    for (const [child, record] of Object.entries(scene.objects)) {
      if (record.parent === result[i]) {
        result.push(child);
      }
    }
  }
  return result;
}

function nextOrder(scene, parent) {
  let last = -1;
  for (const record of Object.values(scene.objects)) {
    if (record.parent === parent) {
      last = Math.max(last, record.order);
    }
  }
  return Math.floor(last) + 1;
}

function checkTree(scene) {
  for (const [id, record] of Object.entries(scene.objects)) {
    if (typeof record.name !== "string" || typeof record.parent !== "string" || typeof record.order !== "number") {
      fail(`${id}: a record needs name (string), parent (string) and order (number)`);
    }
    if (record.parent !== "" && !scene.objects[record.parent]) {
      fail(`${id}: the parent ${JSON.stringify(record.parent)} does not exist`);
    }
    let current = record.parent;
    for (let depth = 0; current !== ""; depth++) {
      if (current === id || depth > 1000) {
        fail(`${id}: the object would be inside itself`);
      }
      current = scene.objects[current]?.parent ?? "";
    }
  }
}

function mergeRecord(record, partial) {
  const result = { ...record };
  for (const [key, value] of Object.entries(partial)) {
    if (key === "components" && value && typeof value === "object") {
      const components = { ...(record.components ?? {}) };
      for (const [name, data] of Object.entries(value)) {
        if (data === null) {
          delete components[name];
        } else {
          components[name] = data;
        }
      }
      if (Object.keys(components).length > 0) {
        result.components = components;
      } else {
        delete result.components;
      }
    } else if (value === null) {
      delete result[key];
    } else {
      result[key] = value;
    }
  }
  return result;
}

function applyPatch(scene, patch) {
  for (const [id, partial] of Object.entries(patch.objects ?? {})) {
    if (partial === null) {
      for (const gone of subtree(scene, id)) {
        delete scene.objects[gone];
      }
    } else if (scene.objects[id]) {
      scene.objects[id] = mergeRecord(scene.objects[id], partial);
    } else {
      scene.objects[id] = { ...partial, order: partial.order ?? nextOrder(scene, partial.parent ?? "") };
    }
  }
  for (const [name, partial] of Object.entries(patch.materials ?? {})) {
    scene.materials[name] = mergeRecord(scene.materials[name] ?? {}, partial);
  }
  if (patch.settings) {
    scene.settings = mergeRecord(scene.settings, patch.settings);
  }
}

async function readStdin() {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    text += chunk;
  }
  return text;
}

// Applies `edit` (a function that changes a copy of the scene) to the version and saves the change.
// A save that meets a change on disk to the same field gets one more try on the new file.
async function edit(version, options, change) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await readVersion(version);
    const base = JSON.parse(current.text);
    const next = clone(base);
    await change(next);
    checkTree(next);
    const changes = diffScene(base, next);
    if (changes.length === 0) {
      console.log("scene: nothing to change");
      return;
    }
    if (options.dry) {
      for (const item of changes) {
        console.log(`${item.kind} ${item.key}:\n  before ${canonical(item.base)}\n  after  ${canonical(item.ours)}`);
      }
      return;
    }
    const result = await saveChanges(version, changes);
    if (result.ok) {
      console.log(`scene: saved version ${version} (${changes.length} unit${changes.length === 1 ? "" : "s"} changed, hash ${result.hash})`);
      return;
    }
    if (attempt === 1) {
      fail(`the file changed in the same fields while saving: ${result.conflicts.map((item) => `${item.key} [${item.fields.join(", ")}]`).join("; ")}`);
    }
  }
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const [command, ...args] = positional;
  if (!command || command === "help" || command === "--help") {
    console.log(HELP);
    return;
  }
  if (command === "versions") {
    const index = await readIndex();
    console.log(`folder: ${sceneDir()}`);
    for (const version of index.versions) {
      console.log(`${version.id === index.latest ? "*" : " "} v${version.id}  ${version.created}  ${version.label ?? ""}`);
    }
    return;
  }
  if (command === "new-version") {
    const result = await createVersion(args.join(" "));
    console.log(`scene: created version ${result.id} (now the latest)${result.removed.length > 0 ? `; removed version ${result.removed.join(", ")}` : ""}`);
    return;
  }
  const version = await resolveVersion(options.version);
  if (command === "get" || command === "find" || command === "children") {
    const scene = JSON.parse((await readVersion(version)).text);
    if (command === "get") {
      console.log(formatJson(need(scene, args[0])));
    } else if (command === "find") {
      const text = (args[0] ?? "").toLowerCase();
      for (const [id, record] of Object.entries(scene.objects)) {
        if (id.toLowerCase().includes(text) || record.name.toLowerCase().includes(text)) {
          console.log(`${id}\t${record.name}`);
        }
      }
    } else {
      const parent = args[0] ?? "";
      const rows = Object.entries(scene.objects).filter(([, record]) => record.parent === parent).sort((a, b) => a[1].order - b[1].order);
      for (const [id, record] of rows) {
        console.log(`${record.order}\t${id}\t${record.name}`);
      }
    }
    return;
  }
  await edit(version, options, async (scene) => {
    if (command === "set") {
      const [id, field, value] = args;
      const record = need(scene, id);
      if (!field) {
        fail("set needs a field");
      }
      setPath(record, field.split("."), parseValue(value));
    } else if (command === "move") {
      const [id, parent, order] = args;
      const record = need(scene, id);
      if (parent !== "" && !scene.objects[parent]) {
        fail(`no parent with id ${JSON.stringify(parent)}`);
      }
      record.parent = parent;
      record.order = order === undefined ? nextOrder(scene, parent) : Number(order);
    } else if (command === "add") {
      const [id, text] = args;
      if (scene.objects[id]) {
        fail(`the id ${JSON.stringify(id)} is taken`);
      }
      const record = parseValue(text);
      scene.objects[id] = { ...record, order: record.order ?? nextOrder(scene, record.parent ?? "") };
    } else if (command === "delete") {
      const [id] = args;
      need(scene, id);
      for (const gone of subtree(scene, id)) {
        delete scene.objects[gone];
      }
    } else if (command === "material") {
      const [name, field, value] = args;
      if (!scene.materials[name]) {
        fail(`no material ${JSON.stringify(name)} in the materials section`);
      }
      setPath(scene.materials[name], [field], parseValue(value));
    } else if (command === "setting") {
      const [key, value] = args;
      setPath(scene.settings, key.split("."), parseValue(value));
    } else if (command === "patch") {
      const [source] = args;
      const text = source === "-" || source === undefined ? await readStdin() : await readFile(source, "utf8");
      applyPatch(scene, cleanNumbers(JSON.parse(text)));
    } else {
      fail(`unknown command ${command}; run yarn scene help`);
    }
  });
}

main().catch((error) => {
  fail(error.message ?? String(error));
});
