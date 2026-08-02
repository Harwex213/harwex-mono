// The renderer's public surface: a stage to boot and the pieces it is built from.
export type { GameStage } from "./stage";
export { createGameStage } from "./stage";
export { GameRenderer } from "./renderer";
export { Camera, DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM } from "./camera";
export type { Layers } from "./layers";
export { createLayers } from "./layers";
export type { Ground } from "./ground";
export { buildGround } from "./ground";
export type { BakedTerrain } from "./terrain";
export { bakeTerrain } from "./terrain";
export type { WaterField, WaterSurface } from "./water";
export { buildWaterSurface } from "./water";
// Render experiments: the flags, and the one thing currently behind one of them.
export type { Experiments } from "./experiments";
export { experiments, setExperiment } from "./experiments";
export type { FogField, FogOfWar, VisionSource } from "./fog";
export { buildFogOfWar } from "./fog";
export { HOVER_STYLE, Marker, SELECTION_STYLE } from "./selection";
export { BuildGhost } from "./ghost";
export { buildingSprite, resourceBadge } from "./buildings";
export type { Buildings, Creature, Fills, Sheets } from "./textures";
export { Facing, fills, loadTextures, sheets, TREE_VARIANTS } from "./textures";
