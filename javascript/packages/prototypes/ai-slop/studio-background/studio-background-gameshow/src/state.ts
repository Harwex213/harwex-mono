import { signal } from "@preact/signals-react";

type ViewTab = "scene" | "game";
type TransformMode = "translate" | "rotate" | "scale";
type RenderMode = "game" | "editor";
type SaveStatus = "saved" | "dirty" | "saving" | "failed";
// Camera shots: the hero wheel in the amphitheatre and the three bonus game stations in the casino hall.
type Shot = "wheel" | "slot" | "dice" | "gameshow";

const SHOTS: Shot[] = ["wheel", "slot", "dice", "gameshow"];

const params = new URLSearchParams(window.location.search);
// `?solo` shows only the Game view over the whole window (for presenting and for 1:1 captures).
const isSolo = params.has("solo");
const activeTab = signal<ViewTab>(isSolo ? "game" : "scene");
const isPlaying = signal(true);
// The three animation channels of the shot. Each one runs only while Play is on.
const swing = signal(true);
const dolly = signal(true);
const spin = signal(true);
// The shot the Main Camera holds. `?shot=dice` starts on that shot; a change makes the camera travel to it.
const shotParam = params.get("shot");
const shot = signal<Shot>(SHOTS.find((item) => item === shotParam) ?? "wheel");
const selectedUuid = signal<string | null>(null);
const transformMode = signal<TransformMode>("translate");
// Bumped whenever an object is edited, so the inspector re-reads the object.
const inspectorRevision = signal(0);
const saveStatus = signal<SaveStatus>("saved");
// Lighting of the Scene view: the game lights, or a flat static light for finding your way around.
const renderMode = signal<RenderMode>("editor");
const undoCount = signal(0);
const redoCount = signal(0);
const fps = signal(0);

export {
  activeTab,
  dolly,
  fps,
  inspectorRevision,
  isPlaying,
  isSolo,
  params,
  redoCount,
  renderMode,
  saveStatus,
  selectedUuid,
  shot,
  SHOTS,
  spin,
  swing,
  transformMode,
  undoCount,
};
export type { RenderMode, SaveStatus, Shot, TransformMode, ViewTab };
