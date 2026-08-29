import { isAvailable } from "../../domain/tech/empire";
import {
  LAYOUT,
  TRUNK_NODE_RADIUS,
  TWIG_NODE_RADIUS,
  VIEW_HEIGHT,
  VIEW_MIN_X,
  VIEW_WIDTH,
  layoutOf,
} from "../../domain/tech/layout";
import { TECHS, techOf } from "../../domain/tech/tech-tree";
import type { TBranch, TPoint, TTech } from "../../domain/tech/types";

type TSceneState = {
  researched: readonly string[];
  hoveredId: string | null;
  /** 0..1 progress of the hovered name reveal. */
  hoverReveal: number;
  selectedId: string | null;
  /** Technology being learned and its 0..1 progress. */
  learning: { techId: string; progress: number } | null;
  camera: TCamera;
};

/** Zoom factor over the fit-to-canvas scale, plus a pan in canvas pixels. */
type TCamera = {
  zoom: number;
  panX: number;
  panY: number;
};

const CAMERA_HOME: TCamera = { zoom: 1, panX: 0, panY: 0 };
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 6;

/** Maps the fixed layout space onto the canvas, keeping the aspect ratio. */
type TViewport = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

const PALETTE = {
  paper: "#f5efe2",
  ink: "#23201c",
  strokeIdle: "#8b857a",
  lit: "#1f6fb5",
  nodeFill: "#f5efe2",
};

const BRANCH_COLOR: Record<TBranch, string> = {
  root: "#6d4fb5",
  army: "#b5452f",
  economy: "#b58a1f",
  science: "#1f6fb5",
};

const createViewport = (width: number, height: number, camera: TCamera): TViewport => {
  const scale = Math.min(width / VIEW_WIDTH, height / VIEW_HEIGHT) * camera.zoom;

  return {
    scale,
    offsetX: (width - VIEW_WIDTH * scale) / 2 - VIEW_MIN_X * scale + camera.panX,
    offsetY: (height - VIEW_HEIGHT * scale) / 2 + camera.panY,
  };
};

/** Zoom by a factor while keeping the layout point under `anchor` fixed on screen. */
const zoomCamera = (camera: TCamera, width: number, height: number, factor: number, anchor: TPoint): TCamera => {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, camera.zoom * factor));
  const before = createViewport(width, height, camera);
  const local = toLayout(before, anchor);
  const after = createViewport(width, height, { ...camera, zoom });
  const moved = toCanvas(after, local);

  return { zoom, panX: camera.panX + anchor.x - moved.x, panY: camera.panY + anchor.y - moved.y };
};

const panCamera = (camera: TCamera, dx: number, dy: number): TCamera => ({
  zoom: camera.zoom,
  panX: camera.panX + dx,
  panY: camera.panY + dy,
});

const toCanvas = (viewport: TViewport, point: TPoint): TPoint => ({
  x: viewport.offsetX + point.x * viewport.scale,
  y: viewport.offsetY + point.y * viewport.scale,
});

const toLayout = (viewport: TViewport, point: TPoint): TPoint => ({
  x: (point.x - viewport.offsetX) / viewport.scale,
  y: (point.y - viewport.offsetY) / viewport.scale,
});

const radiusOf = (tech: TTech): number => (tech.slot === "trunk" ? TRUNK_NODE_RADIUS + 7 : TWIG_NODE_RADIUS + 7);

/** Every ancestor of a node, used to light up the path on hover. */
const ancestorsOf = (id: string): Set<string> => {
  const result = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.pop()!;
    techOf(current).requires.forEach((requirement) => {
      if (!result.has(requirement)) {
        result.add(requirement);
        queue.push(requirement);
      }
    });
  }

  return result;
};

/** The node under a canvas-space point, or null. */
const hitTest = (viewport: TViewport, point: TPoint): string | null => {
  const local = toLayout(viewport, point);
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  TECHS.forEach((tech) => {
    const layout = layoutOf(tech.id);
    const distance = Math.hypot(layout.point.x - local.x, layout.point.y - local.y);
    if (distance <= radiusOf(tech) + 6 && distance < bestDistance) {
      best = tech.id;
      bestDistance = distance;
    }
  });

  return best;
};

/** A slight bow keeps the strokes from reading as ruler lines. */
const strokePath = (ctx: CanvasRenderingContext2D, from: TPoint, to: TPoint, bow: number): void => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const controlX = (from.x + to.x) / 2 + (-dy / length) * bow;
  const controlY = (from.y + to.y) / 2 + (dx / length) * bow;

  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(controlX, controlY, to.x, to.y);
  ctx.stroke();
};

const drawStrokes = (ctx: CanvasRenderingContext2D, viewport: TViewport, state: TSceneState, litPath: Set<string>): void => {
  ctx.lineCap = "round";

  LAYOUT.forEach((layout) => {
    if (!layout.parentId) {
      return;
    }

    const tech = techOf(layout.id);
    const done = state.researched.includes(layout.id);
    const lit = state.hoveredId === layout.id || litPath.has(layout.id);
    const bow = tech.slot === "trunk" ? (tech.tier % 2 === 0 ? 10 : -10) : 6;

    ctx.strokeStyle = lit ? PALETTE.lit : done ? PALETTE.ink : PALETTE.strokeIdle;
    ctx.lineWidth = (tech.slot === "trunk" ? 4 : 2.5) * viewport.scale;
    ctx.setLineDash(done || tech.slot === "trunk" ? [] : [6 * viewport.scale, 5 * viewport.scale]);
    strokePath(ctx, toCanvas(viewport, layoutOf(layout.parentId).point), toCanvas(viewport, layout.point), bow * viewport.scale);
  });

  ctx.setLineDash([]);
};

const drawNodes = (ctx: CanvasRenderingContext2D, viewport: TViewport, state: TSceneState, litPath: Set<string>): void => {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  TECHS.forEach((tech) => {
    const center = toCanvas(viewport, layoutOf(tech.id).point);
    const radius = radiusOf(tech) * viewport.scale;
    const done = state.researched.includes(tech.id);
    const available = isAvailable(tech.id, state.researched);
    const hovered = state.hoveredId === tech.id;
    const selected = state.selectedId === tech.id;
    const color = BRANCH_COLOR[tech.branch];

    ctx.globalAlpha = done || available ? 1 : 0.4;

    if (available) {
      ctx.fillStyle = "rgba(31, 111, 181, 0.16)";
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius + 8 * viewport.scale, 0, Math.PI * 2);
      ctx.fill();
    }

    if (selected) {
      ctx.fillStyle = "rgba(35, 32, 28, 0.14)";
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius + 8 * viewport.scale, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = done ? color : PALETTE.nodeFill;
    ctx.strokeStyle = done ? color : available || hovered || selected ? PALETTE.ink : PALETTE.strokeIdle;
    ctx.lineWidth = (hovered || selected ? 4 : 2.5) * viewport.scale;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.font = `${radius * 1.15}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.fillStyle = PALETTE.ink;
    ctx.fillText(tech.icon, center.x, center.y + radius * 0.06);

    if (litPath.has(tech.id) && !hovered) {
      ctx.strokeStyle = PALETTE.lit;
      ctx.lineWidth = 2 * viewport.scale;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius + 3 * viewport.scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (state.learning && state.learning.techId === tech.id) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 4 * viewport.scale;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius + 6 * viewport.scale, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * state.learning.progress);
      ctx.stroke();
    }
  });

  ctx.globalAlpha = 1;
};

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);

/** The hovered node's name, written underneath and revealed from the center outward. */
const drawHoverName = (ctx: CanvasRenderingContext2D, viewport: TViewport, state: TSceneState): void => {
  if (!state.hoveredId) {
    return;
  }

  const tech = techOf(state.hoveredId);
  const center = toCanvas(viewport, layoutOf(tech.id).point);
  const radius = radiusOf(tech) * viewport.scale;
  const reveal = easeOut(Math.min(1, state.hoverReveal));
  const fontSize = Math.max(13, Math.min(22, 14 * viewport.scale));

  ctx.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const width = ctx.measureText(tech.name).width;
  const top = center.y + radius + 6;
  const halfVisible = (width / 2 + 4) * reveal;

  ctx.save();
  ctx.beginPath();
  ctx.rect(center.x - halfVisible, top - 2, halfVisible * 2, fontSize + 6);
  ctx.clip();
  ctx.globalAlpha = reveal;
  ctx.fillStyle = "rgba(245, 239, 226, 0.85)";
  ctx.fillRect(center.x - width / 2 - 4, top - 2, width + 8, fontSize + 6);
  ctx.fillStyle = PALETTE.ink;
  ctx.fillText(tech.name, center.x, top);
  ctx.restore();
};

const renderScene = (ctx: CanvasRenderingContext2D, width: number, height: number, state: TSceneState): void => {
  const viewport = createViewport(width, height, state.camera);
  const litPath = state.hoveredId ? ancestorsOf(state.hoveredId) : new Set<string>();

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(0, 0, width, height);

  drawStrokes(ctx, viewport, state, litPath);
  drawNodes(ctx, viewport, state, litPath);
  drawHoverName(ctx, viewport, state);
};

export type { TCamera, TSceneState, TViewport };
export { CAMERA_HOME, createViewport, hitTest, panCamera, radiusOf, renderScene, toCanvas, zoomCamera };
