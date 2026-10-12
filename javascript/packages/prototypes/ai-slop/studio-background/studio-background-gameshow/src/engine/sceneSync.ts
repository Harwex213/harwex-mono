import { conflicts, editorHint, latestVersion, openVersion, params, saveStatus, sceneLive, syncNote, versionRemoved, versions } from "../state";
import type { VersionInfo } from "../state";
import type { SceneDocument } from "./sceneDocument";
import { FORMAT, VERSION } from "./sceneFormat";
import type { SceneFile } from "./sceneFormat";
import { describeUnit, diffScene, hashText, mergeChanges, resolveUnit, same, setUnit, unitOf } from "./sceneMerge";
import type { Conflict } from "./sceneMerge";

// The link between the open tab and the scene versions on disk (src/scene/versions/, docs/scene-format.md).
//
// The tab keeps `base`: the file on disk as the tab saw it last. The edits of the tab are the difference between
// `base` and the scene in the tab.
// - Pull: the dev server says that the file of the open version changed (an agent, `yarn scene`, a hand edit,
//   another tab). The tab merges the edits of the tab onto the new file (sceneMerge.ts) and shows the result.
//   The unsaved edits of the tab stay on top. A field that both sides changed is a conflict: the tab keeps its own
//   value and lists the conflict until the user picks a side. The new file becomes `base`.
// - Save: the tab sends only its edits (each changed unit with its value in `base`). The dev server merges them
//   into the file as it is on disk now and writes it atomically. It refuses with the list of conflicts when the disk
//   changed the same field in the meantime; the tab then pulls and shows them. Save is off while conflicts are open.
// - The tab saves and pulls one at a time (`queue`). A file event with the hash of `base` is the echo of the own
//   save: the tab ignores it.
// The page loads the files with fetch: they are not modules, so a save never rebuilds the bundle or reloads the page.

interface VersionIndex {
  latest: number;
  versions: VersionInfo[];
}

interface OpenedScene {
  index: VersionIndex;
  version: number;
  file: SceneFile;
  hash: string;
}

const FILES_URL = "scene/versions/";
const SAVE_URL = "__scene/save";
const VERSIONS_URL = "__scene/versions";
const EVENTS_URL = "__scene/events";
const NOTE_SECONDS = 6;

function fileName(version: number): string {
  return `${String(version).padStart(3, "0")}.json`;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

// Loads the version named by `?v=3`, or the latest one.
async function openScene(): Promise<OpenedScene> {
  const index = JSON.parse(await fetchText(`${FILES_URL}index.json`)) as VersionIndex;
  const wanted = params.get("v");
  let version = wanted === null ? index.latest : Number(wanted);
  if (!index.versions.some((item) => item.id === version)) {
    console.warn(`[scene] version ${wanted} does not exist; the latest version ${index.latest} opens instead`);
    version = index.latest;
  }
  const text = await fetchText(`${FILES_URL}${fileName(version)}`);
  return { index, version, file: JSON.parse(text) as SceneFile, hash: hashText(text) };
}

function unitKey(conflict: Conflict): string {
  return `${conflict.kind}:${conflict.key}`;
}

class SceneSync {
  private readonly document: SceneDocument;
  private version: number;
  private base: SceneFile;
  private baseHash: string;
  private queue: Promise<void> = Promise.resolve();
  private noteTimer = 0;

  constructor(document: SceneDocument, opened: OpenedScene) {
    this.document = document;
    this.version = opened.version;
    this.base = opened.file;
    this.baseHash = opened.hash;
    openVersion.value = opened.version;
    this.setIndex(opened.index);
  }

  // Listens to the dev server. A build has no event stream: the tab stays read-only.
  connect(): void {
    const source = new EventSource(EVENTS_URL);
    let wasOpen = false;
    source.onopen = () => {
      sceneLive.value = true;
      if (wasOpen) {
        // Back after a break: a change may have come in between.
        void this.enqueue(() => this.pull());
      }
      wasOpen = true;
    };
    source.onerror = () => {
      sceneLive.value = false;
      if (!wasOpen) {
        source.close();
      }
    };
    source.addEventListener("file", (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { version: number; hash: string };
      if (data.version === this.version && data.hash !== this.baseHash) {
        void this.enqueue(() => this.pull());
      }
    });
    source.addEventListener("index", (event) => {
      this.setIndex(JSON.parse((event as MessageEvent<string>).data) as VersionIndex);
    });
  }

  save(): Promise<void> {
    return this.enqueue(() => this.saveNow());
  }

  // Reads the open version from disk and merges it into the tab.
  pullNow(): Promise<void> {
    return this.enqueue(() => this.pull());
  }

  // Takes one side for the fields of a conflict.
  resolve(conflict: Conflict, side: "ours" | "theirs"): void {
    const key = unitKey(conflict);
    if (side === "theirs") {
      const current = this.document.toFile();
      const latest = { ...conflict, theirs: unitOf(this.base, conflict.kind, conflict.key) };
      const target: SceneFile = { ...current, objects: { ...current.objects }, materials: { ...current.materials } };
      setUnit(target, conflict.kind, conflict.key, resolveUnit(latest, unitOf(current, conflict.kind, conflict.key), "theirs"));
      this.document.applyFile(target, current);
    }
    conflicts.value = conflicts.peek().filter((item) => unitKey(item) !== key);
    this.updateStatus();
  }

  resolveAll(side: "ours" | "theirs"): void {
    for (const conflict of conflicts.peek()) {
      this.resolve(conflict, side);
    }
  }

  // A new version: a copy of the latest on disk. It becomes the latest.
  // A tab on the latest version moves onto the copy and keeps its unsaved edits; any other tab opens the copy.
  createVersion(label?: string): Promise<void> {
    return this.enqueue(async () => {
      const previous = latestVersion.peek();
      let result: { index: VersionIndex; id: number; removed: number[] };
      try {
        const response = await fetch(VERSIONS_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) });
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        result = (await response.json()) as typeof result;
      } catch (error) {
        console.error("[scene] cannot create a version: the endpoint exists only in `yarn dev`", error);
        this.note("A new version needs `yarn dev`.");
        return;
      }
      this.setIndex(result.index);
      const removed = result.removed.length > 0 ? ` Version ${result.removed.join(", ")} was removed.` : "";
      if (this.version === previous) {
        this.version = result.id;
        openVersion.value = result.id;
        versionRemoved.value = false;
        if (params.has("v")) {
          const url = new URL(window.location.href);
          url.searchParams.set("v", String(result.id));
          window.history.replaceState(null, "", url);
        }
        this.note(`Now on version ${result.id}, the new latest.${removed}`);
        return;
      }
      this.note(`Version ${result.id} created.${removed}`);
      this.open(result.id);
    });
  }

  // Opens another version in this tab (a page load).
  open(version: number): void {
    if (version === this.version) {
      return;
    }
    if (saveStatus.peek() !== "saved" && !window.confirm(`Version ${this.version} has unsaved edits. They are lost when version ${version} opens. Open it?`)) {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("v", String(version));
    window.location.assign(url);
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task).catch((error: unknown) => {
      console.error("[scene] sync failed", error);
    });
    this.queue = next;
    return next;
  }

  private async saveNow(): Promise<void> {
    if (versionRemoved.peek()) {
      this.hint(`Version ${this.version} was removed. Make a new version to keep these edits.`);
      return;
    }
    if (conflicts.peek().length > 0) {
      this.hint("Pick a side for every conflict first.");
      return;
    }
    const sent = this.document.toFile();
    const changes = diffScene(this.base, sent);
    if (changes.length === 0) {
      saveStatus.value = "saved";
      return;
    }
    saveStatus.value = "saving";
    let response: Response;
    try {
      response = await fetch(SAVE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: this.version, changes }),
      });
    } catch (error) {
      console.error("[scene] save failed: the save endpoint exists only in `yarn dev`", error);
      saveStatus.value = "failed";
      return;
    }
    if (response.status === 409) {
      // The disk changed the same fields since the last pull: pull now, the conflicts show up.
      saveStatus.value = "dirty";
      await this.pull();
      this.hint("The file changed on disk in the same fields. Pick a side, then save again.");
      return;
    }
    if (!response.ok) {
      console.error(`[scene] save failed: ${response.status} ${response.statusText}`);
      saveStatus.value = "failed";
      return;
    }
    const saved = (await response.json()) as { hash: string; text: string };
    saveStatus.value = "saved";
    // The file on disk now holds `sent` plus the changes of others: the edits made during the save stay unsaved.
    this.integrate(JSON.parse(saved.text) as SceneFile, saved.hash, sent);
  }

  private async pull(): Promise<void> {
    let text: string;
    try {
      text = await fetchText(`${FILES_URL}${fileName(this.version)}`);
    } catch {
      return;
    }
    const hash = hashText(text);
    if (hash === this.baseHash) {
      return;
    }
    let theirs: SceneFile;
    try {
      theirs = JSON.parse(text) as SceneFile;
    } catch {
      this.note("The file on disk does not parse. The tab waits for the next change.");
      return;
    }
    this.integrate(theirs, hash, this.base);
  }

  // Merges the edits of the tab (from `base` to the scene now) onto `theirs` and shows the result.
  private integrate(theirs: SceneFile, hash: string, base: SceneFile): void {
    if (theirs.format !== FORMAT || theirs.version !== VERSION) {
      this.note(`The file on disk has format ${theirs.format} ${theirs.version}; the tab reads ${FORMAT} ${VERSION}.`);
      return;
    }
    const now = this.document.toFile();
    const local = diffScene(base, now);
    const result = mergeChanges(theirs, local);
    const change = this.document.applyFile(result.mine, now);
    this.base = theirs;
    this.baseHash = hash;
    // Conflicts stay until the user picks a side, also over later pulls. A unit that is now equal on both sides is no conflict.
    const open = new Map(conflicts.peek().map((item) => [unitKey(item), item]));
    for (const item of result.conflicts) {
      open.set(unitKey(item), item);
    }
    for (const [key, item] of open) {
      const theirsUnit = unitOf(theirs, item.kind, item.key);
      if (same(unitOf(result.mine, item.kind, item.key), theirsUnit)) {
        open.delete(key);
      } else {
        open.set(key, { ...item, theirs: theirsUnit });
      }
    }
    conflicts.value = [...open.values()];
    this.updateStatus(result.mine);
    const parts: string[] = [];
    if (change.objects > 0) {
      parts.push(`${change.objects} object${change.objects === 1 ? "" : "s"}`);
    }
    if (change.settings) {
      parts.push("settings");
    }
    if (parts.length > 0 || result.conflicts.length > 0) {
      const conflictText = result.conflicts.length > 0 ? ` ${result.conflicts.length} conflict${result.conflicts.length === 1 ? "" : "s"}: ${result.conflicts.map((item) => describeUnit(item.kind, item.key)).join(", ")}.` : "";
      this.note(`${parts.length > 0 ? `Changes from disk: ${parts.join(", ")}.` : ""}${conflictText}`.trim());
    }
  }

  private updateStatus(current: SceneFile = this.document.toFile()): void {
    if (saveStatus.peek() === "saving") {
      return;
    }
    saveStatus.value = conflicts.peek().length > 0 || diffScene(this.base, current).length > 0 ? "dirty" : "saved";
  }

  private setIndex(index: VersionIndex): void {
    versions.value = [...index.versions].sort((a, b) => a.id - b.id);
    latestVersion.value = index.latest;
    versionRemoved.value = !index.versions.some((item) => item.id === this.version);
  }

  private note(message: string): void {
    syncNote.value = message;
    window.clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => {
      syncNote.value = "";
    }, NOTE_SECONDS * 1000);
  }

  private hint(message: string): void {
    console.warn(`[scene] ${message}`);
    editorHint.value = message;
    window.setTimeout(() => {
      if (editorHint.peek() === message) {
        editorHint.value = "";
      }
    }, NOTE_SECONDS * 1000);
  }
}

const MAX_VERSIONS = 10;

export { MAX_VERSIONS, SceneSync, openScene };
export type { OpenedScene, VersionIndex };
