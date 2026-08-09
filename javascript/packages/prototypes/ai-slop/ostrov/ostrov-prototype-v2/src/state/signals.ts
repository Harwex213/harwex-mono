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

export { camera, dragging, hovered, selected, viewport, world };
