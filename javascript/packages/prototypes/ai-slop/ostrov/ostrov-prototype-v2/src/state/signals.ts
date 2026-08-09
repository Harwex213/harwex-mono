import { config } from "@hw/ostrov-prototype-v2-config";
import { signal } from "@preact/signals-react";
import type { Axial } from "../hex/coords";
import type { WorldMap } from "../map/world";
import { generateWorld } from "../map/world";
import type { Camera, Viewport } from "./camera";

const world = signal<WorldMap>(generateWorld(config.world.seed));
const camera = signal<Camera>({ x: 0, y: 0, scale: 1 });
/**
 * Size of the map canvas. The minimap needs it to draw the viewport rectangle,
 * and the camera clamp needs it to know how much world one screen holds.
 */
const viewport = signal<Viewport>({ width: 0, height: 0 });
const hovered = signal<Axial | null>(null);
const selected = signal<Axial | null>(null);
const dragging = signal(false);
/**
 * Bumped whenever a tile changes owner.
 *
 * Ownership lives on the tile objects themselves, so nothing about the world
 * signal changes when ground is claimed. This counter is what tells the fog
 * field, the territory outline and both canvases that the map they cached is
 * out of date.
 */
const territoryVersion = signal(0);

export { camera, dragging, hovered, selected, territoryVersion, viewport, world };
