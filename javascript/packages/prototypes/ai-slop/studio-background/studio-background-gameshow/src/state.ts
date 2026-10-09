import { signal } from "@preact/signals-react";

type ViewTab = "scene" | "game";
type TransformMode = "translate" | "rotate" | "scale";
type RenderMode = "game" | "editor";
type SaveStatus = "saved" | "dirty" | "saving" | "failed";
// Camera shots: the hero wheel in the amphitheatre (Main Wheel) and one shot per bonus game: Bonus Dice,
// Bonus Show on the Game Show platform of the annex, and Bonus Luck (the slot cabinet).
type Shot = "wheel" | "dice" | "show" | "luck";

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

export {
  activeTab,
  dolly,
  editorHint,
  fps,
  inspectorRevision,
  isPlaying,
  isSolo,
  params,
  redoCount,
  renamingUuid,
  renderMode,
  saveStatus,
  selectedUuid,
  shot,
  SHOTS,
  spin,
  structureRevision,
  swing,
  transformMode,
  undoCount,
};
export type { RenderMode, SaveStatus, Shot, TransformMode, ViewTab };
