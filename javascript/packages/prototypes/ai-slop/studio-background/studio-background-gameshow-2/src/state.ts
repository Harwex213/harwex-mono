import { signal } from "@preact/signals-react";

type ViewTab = "scene" | "game";
type TransformMode = "translate" | "rotate" | "scale";

// `?solo` shows only the Game view over the whole window (for presenting and for 1:1 captures).
const isSolo = new URLSearchParams(window.location.search).has("solo");
const activeTab = signal<ViewTab>(isSolo ? "game" : "scene");
const isPlaying = signal(true);
const selectedUuid = signal<string | null>(null);
const transformMode = signal<TransformMode>("translate");
// Bumped whenever a transform is edited, so the inspector re-reads the object.
const inspectorRevision = signal(0);
const fps = signal(0);

export { activeTab, fps, inspectorRevision, isPlaying, isSolo, selectedUuid, transformMode };
export type { TransformMode, ViewTab };
