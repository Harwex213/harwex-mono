import { signal } from "@preact/signals-react";
import type { Conflict } from "./engine/sceneMerge";

type ViewTab = "scene" | "game";
type TransformMode = "translate" | "rotate" | "scale";
type RenderMode = "game" | "editor";
type SaveStatus = "saved" | "dirty" | "saving" | "failed";
// Camera shots: the hero wheel in the amphitheatre (Main Wheel) and one shot per bonus game: Bonus Dice,
// Bonus Show on the Game Show platform of the annex, and Bonus Luck (the slot cabinet).
type Shot = "wheel" | "dice" | "show" | "luck";
// One entry of src/scene/versions/index.json.
interface VersionInfo {
  id: number;
  label?: string;
  created?: string;
  from?: number;
}

const SHOTS: Shot[] = ["wheel", "dice", "show", "luck"];

const params = new URLSearchParams(window.location.search);
// `?solo` shows only the Game view over the whole window (for presenting and for 1:1 captures).
const isSolo = params.has("solo");
const activeTab = signal<ViewTab>(isSolo ? "game" : "scene");
const isPlaying = signal(true);
// The three animation channels of the shot. Each one runs only while Play is on.
const swing = signal(true);
const dolly = signal(true);
const spin = signal(true);
// The shot the Main Camera holds. `?shot=show` starts on that shot; a change makes the camera travel to it.
const shotParam = params.get("shot");
const shot = signal<Shot>(SHOTS.find((item) => item === shotParam) ?? "wheel");
const selectedUuid = signal<string | null>(null);
const transformMode = signal<TransformMode>("translate");
// Bumped whenever an object is edited, so the inspector re-reads the object.
const inspectorRevision = signal(0);
// Bumped whenever the tree changes: an object added, deleted, moved or renamed.
const structureRevision = signal(0);
// The Hierarchy row that shows a name field (F2 or double-click).
const renamingUuid = signal<string | null>(null);
// A short message for the toolbar, like why an object cannot be deleted. Empty when there is none.
const editorHint = signal("");
const saveStatus = signal<SaveStatus>("saved");
// Lighting of the Scene view: the game lights, or a flat static light for finding your way around.
const renderMode = signal<RenderMode>("editor");
const undoCount = signal(0);
const redoCount = signal(0);
const fps = signal(0);
// Scene versions (sceneSync.ts): the version open in this tab, the list on disk and the latest one.
const openVersion = signal(0);
const versions = signal<VersionInfo[]>([]);
const latestVersion = signal(0);
// True while the dev server sends the changes on disk. False in a build: the tab is read-only.
const sceneLive = signal(false);
// The open version left the list (the 11th version removed it): Save is off.
const versionRemoved = signal(false);
// The units that this tab and the disk both changed in the same field. Save is off until each one has a side.
const conflicts = signal<Conflict[]>([]);
// A short note about the last change that came from disk. Empty when there is none.
const syncNote = signal("");

export {
  activeTab,
  conflicts,
  dolly,
  editorHint,
  fps,
  inspectorRevision,
  isPlaying,
  isSolo,
  latestVersion,
  openVersion,
  params,
  redoCount,
  renamingUuid,
  renderMode,
  saveStatus,
  sceneLive,
  selectedUuid,
  shot,
  SHOTS,
  spin,
  structureRevision,
  swing,
  syncNote,
  transformMode,
  undoCount,
  versionRemoved,
  versions,
};
export type { RenderMode, SaveStatus, Shot, TransformMode, VersionInfo, ViewTab };
