import { effect, signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import {
  BUILDINGS_GROUP,
  NODE_X_FIELD,
  NODE_Y_FIELD,
  NO_PREREQUISITE,
  PREREQUISITE_FIELD,
  entityEntries,
  fieldEntries,
} from "../schema";
import type { Field } from "../types";
import { FieldRow } from "./FieldRow";
import type { Graph, GraphEdge, GraphNode, LinkVerdict } from "./graph";
import {
  BUILDINGS,
  BUILDING_ENTITIES,
  NODE_HEIGHT,
  NODE_WIDTH,
  buildGraph,
  edgeAt,
  edgeCurve,
  edgePointAt,
  linkVerdict,
} from "./graph";
import type { IconKind } from "./icons";
import { drawIcon } from "./icons";
import { setField, status, values } from "./state";

/**
 * The buildings page: the tech tree on a canvas on the left, the fields of the
 * selected building on the right.
 *
 * The canvas owns nothing. Node positions and prerequisites are ordinary fields
 * of the buildings template, so dragging a node or drawing a link lands in the
 * same edit buffer as a slider and rides the same Save button.
 */

const MIN_SCALE = 0.35;

const MAX_SCALE = 2.2;

const GRID_STEP = 60;

/** Radius of the dot on the right edge of a node that starts a link drag. */
const HANDLE_RADIUS = 7;

/** How far the pointer may sit from a handle and still grab it. */
const HANDLE_GRAB = 12;

/** How far the pointer may sit from an edge and still hit it, in graph units. */
const EDGE_GRAB = 13;

/** Radius of the ✕ badge that sits on a hovered edge. */
const BADGE_RADIUS = 9;

/** A press that travels less than this is a click, not a pan. */
const CLICK_SLOP = 4;

const COLOURS = {
  grid: "rgba(150, 205, 240, 0.09)",
  edge: "rgba(150, 205, 240, 0.45)",
  edgeCycle: "#ff8f8f",
  nodeFill: "#1a2f42",
  nodeFillRoot: "#1d3850",
  nodeEdge: "rgba(150, 205, 240, 0.3)",
  nodeEdgeSelected: "#7fc0ff",
  nodeEdgeCycle: "#ff8f8f",
  title: "#ffd479",
  text: "#e8f2fa",
  handle: "rgba(150, 205, 240, 0.55)",
  ok: "#86e0a5",
  warn: "#ffd479",
  bad: "#ff8f8f",
  hintBack: "rgba(10, 22, 32, 0.94)",
};

const selected = signal<string>(BUILDING_ENTITIES[0]![0]);

/** Pan and zoom of the canvas. Kept out of the config: it is not game data. */
const view = { x: 0, y: 0, scale: 1 };

/** The view is fitted to the graph once, not on every visit to the page. */
let fitted = false;

/** What the pointer is over while no button is down. Drives cursor and accents. */
type Hover = {
  /** Node whose link handle is under the pointer. */
  handleId: string | null;
  /** Child id of the edge under the pointer. One child carries one edge. */
  edgeTo: string | null;
  /** Pointer inside the canvas, in CSS pixels, where the hint is drawn. */
  hintX: number;
  hintY: number;
};

const hover: Hover = { handleId: null, edgeTo: null, hintX: 0, hintY: 0 };

/** A link being drawn from the handle of `sourceId` to wherever the pointer is. */
type LinkDrag = {
  sourceId: string;
  /** Pointer in graph space, where the preview line ends. */
  x: number;
  y: number;
  /** Pointer inside the canvas, in CSS pixels, where the hint is drawn. */
  screenX: number;
  screenY: number;
  targetId: string | null;
  verdict: LinkVerdict | null;
};

let linkDrag: LinkDrag | null = null;

/** Pan and zoom that put the whole graph inside a canvas of this size. */
function fitView(graph: Graph, width: number, height: number): void {
  if (graph.nodes.length === 0 || width < 2 || height < 2) {
    return;
  }
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of graph.nodes) {
    left = Math.min(left, node.x);
    top = Math.min(top, node.y);
    right = Math.max(right, node.x + NODE_WIDTH);
    bottom = Math.max(bottom, node.y + NODE_HEIGHT);
  }
  const padding = 26;
  const scale = Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, Math.min((width - padding * 2) / (right - left), (height - padding * 2) / (bottom - top))),
  );
  view.scale = Math.min(1, scale);
  view.x = (width - (right - left) * view.scale) / 2 - left * view.scale;
  view.y = (height - (bottom - top) * view.scale) / 2 - top * view.scale;
}

type Pointer = {
  mode: "pan" | "node";
  /** Pointer position in screen space when the gesture started. */
  startX: number;
  startY: number;
  /** View offset when a pan started. */
  viewX: number;
  viewY: number;
  /** Grab point inside the node, in graph space. */
  grabX: number;
  grabY: number;
  nodeId: string;
  /** Edge the press started on, offered for removal if the press does not travel. */
  edgeTo: string | null;
  moved: boolean;
};

function toGraphX(clientX: number, rect: DOMRect): number {
  return (clientX - rect.left - view.x) / view.scale;
}

function toGraphY(clientY: number, rect: DOMRect): number {
  return (clientY - rect.top - view.y) / view.scale;
}

/** Topmost node under a point in graph space, or `null`. */
function nodeAt(graph: Graph, x: number, y: number): GraphNode | null {
  for (let index = graph.nodes.length - 1; index >= 0; index -= 1) {
    const node = graph.nodes[index]!;
    if (x >= node.x && x <= node.x + NODE_WIDTH && y >= node.y && y <= node.y + NODE_HEIGHT) {
      return node;
    }
  }
  return null;
}

function handleX(node: GraphNode): number {
  return node.x + NODE_WIDTH;
}

function handleY(node: GraphNode): number {
  return node.y + NODE_HEIGHT / 2;
}

/** Node whose link handle is under a point. Checked before the node body. */
function handleAt(graph: Graph, x: number, y: number): GraphNode | null {
  for (let index = graph.nodes.length - 1; index >= 0; index -= 1) {
    const node = graph.nodes[index]!;
    if (Math.hypot(handleX(node) - x, handleY(node) - y) <= HANDLE_GRAB) {
      return node;
    }
  }
  return null;
}

/**
 * Keeps the rest of a gesture coming to the canvas even when the pointer
 * leaves it. A browser refuses the capture for a pointer it no longer tracks,
 * which is not a reason to drop the gesture.
 */
function capturePointer(canvas: HTMLCanvasElement, pointerId: number): void {
  try {
    canvas.setPointerCapture(pointerId);
  } catch {
    // The gesture still works, it just stops at the edge of the canvas.
  }
}

function labelOf(graph: Graph, id: string): string {
  return graph.nodes.find((node) => node.id === id)?.label ?? id;
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const left = -view.x / view.scale;
  const top = -view.y / view.scale;
  const right = left + width / view.scale;
  const bottom = top + height / view.scale;
  ctx.beginPath();
  for (let x = Math.floor(left / GRID_STEP) * GRID_STEP; x < right; x += GRID_STEP) {
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }
  for (let y = Math.floor(top / GRID_STEP) * GRID_STEP; y < bottom; y += GRID_STEP) {
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.strokeStyle = COLOURS.grid;
  ctx.lineWidth = 1 / view.scale;
  ctx.stroke();
}

type EdgeStyle = {
  colour: string;
  width: number;
  dashed: boolean;
};

/** One prerequisite link: a flat S-curve from the parent, arrowhead on the child. */
function drawEdge(ctx: CanvasRenderingContext2D, from: GraphNode, to: GraphNode, style: EdgeStyle): void {
  const curve = edgeCurve(from, to);
  ctx.save();
  if (style.dashed) {
    ctx.setLineDash([7, 5]);
  }
  ctx.beginPath();
  ctx.moveTo(curve.startX, curve.startY);
  ctx.bezierCurveTo(curve.bend1X, curve.bend1Y, curve.bend2X, curve.bend2Y, curve.endX, curve.endY);
  ctx.strokeStyle = style.colour;
  ctx.lineWidth = style.width;
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(to.x, curve.endY);
  ctx.lineTo(to.x - 12, curve.endY - 6);
  ctx.lineTo(to.x - 12, curve.endY + 6);
  ctx.closePath();
  ctx.fillStyle = style.colour;
  ctx.fill();
}

/** The ✕ that removes a link, drawn on the middle of the edge under the pointer. */
function drawEdgeBadge(ctx: CanvasRenderingContext2D, from: GraphNode, to: GraphNode): void {
  const middle = edgePointAt(edgeCurve(from, to), 0.5);
  ctx.beginPath();
  ctx.arc(middle.x, middle.y, BADGE_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = COLOURS.hintBack;
  ctx.fill();
  ctx.strokeStyle = COLOURS.bad;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const arm = 3.4;
  ctx.beginPath();
  ctx.moveTo(middle.x - arm, middle.y - arm);
  ctx.lineTo(middle.x + arm, middle.y + arm);
  ctx.moveTo(middle.x + arm, middle.y - arm);
  ctx.lineTo(middle.x - arm, middle.y + arm);
  ctx.strokeStyle = COLOURS.bad;
  ctx.lineWidth = 1.8;
  ctx.stroke();
}

/** One number of a node card: its icon, then the value, always in the same slot. */
function drawStat(
  ctx: CanvasRenderingContext2D,
  kind: IconKind,
  x: number,
  baseline: number,
  text: string,
): void {
  drawIcon(ctx, kind, x, baseline - 11.5, 13);
  ctx.fillStyle = COLOURS.text;
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x + 17, baseline, 66);
}

/** Outline a node gets while a link drag hovers it, or `null` for the usual one. */
type NodeAccent = "source" | "ok" | "replace" | "bad" | null;

function drawNode(ctx: CanvasRenderingContext2D, node: GraphNode, isSelected: boolean, accent: NodeAccent): void {
  const isRoot = node.requires === NO_PREREQUISITE;
  ctx.beginPath();
  ctx.roundRect(node.x, node.y, NODE_WIDTH, NODE_HEIGHT, 12);
  ctx.fillStyle = isRoot ? COLOURS.nodeFillRoot : COLOURS.nodeFill;
  ctx.fill();
  if (accent === "ok") {
    ctx.strokeStyle = COLOURS.ok;
    ctx.lineWidth = 2.5;
  } else if (accent === "replace") {
    ctx.strokeStyle = COLOURS.warn;
    ctx.lineWidth = 2.5;
  } else if (accent === "bad") {
    ctx.strokeStyle = COLOURS.bad;
    ctx.lineWidth = 2.5;
  } else if (accent === "source") {
    ctx.strokeStyle = COLOURS.nodeEdgeSelected;
    ctx.lineWidth = 2.5;
  } else if (node.onCycle) {
    ctx.strokeStyle = COLOURS.nodeEdgeCycle;
    ctx.lineWidth = 2;
  } else if (isSelected) {
    ctx.strokeStyle = COLOURS.nodeEdgeSelected;
    ctx.lineWidth = 2;
  } else {
    ctx.strokeStyle = COLOURS.nodeEdge;
    ctx.lineWidth = 1;
  }
  ctx.stroke();

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLOURS.title;
  ctx.font = "600 13.5px system-ui, sans-serif";
  ctx.fillText(node.label, node.x + 14, node.y + 25, NODE_WIDTH - 34);

  // Four slots, always in the same place, so two cards can be read against
  // each other. A building without gold shows a zero instead of shrinking.
  drawStat(ctx, "wood", node.x + 14, node.y + 50, String(node.costWood));
  drawStat(ctx, "stone", node.x + 110, node.y + 50, String(node.costStone));
  drawStat(ctx, "gold", node.x + 14, node.y + 70, String(node.costGold));
  drawStat(ctx, "time", node.x + 110, node.y + 70, `${node.buildTimeSec} с`);
}

function drawHandle(ctx: CanvasRenderingContext2D, node: GraphNode, hot: boolean): void {
  const x = handleX(node);
  const y = handleY(node);
  ctx.beginPath();
  ctx.arc(x, y, hot ? HANDLE_RADIUS + 2 : HANDLE_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = hot ? COLOURS.nodeEdgeSelected : COLOURS.nodeFill;
  ctx.fill();
  ctx.strokeStyle = hot ? COLOURS.nodeEdgeSelected : COLOURS.handle;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const arm = hot ? 4 : 3;
  ctx.beginPath();
  ctx.moveTo(x - arm, y);
  ctx.lineTo(x + arm, y);
  ctx.moveTo(x, y - arm);
  ctx.lineTo(x, y + arm);
  ctx.strokeStyle = hot ? "#0d1a26" : COLOURS.handle;
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

/** A one-line label pinned next to the pointer, in screen pixels. */
function drawHint(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  x: number,
  y: number,
  text: string,
  colour: string,
): void {
  ctx.font = "12px system-ui, sans-serif";
  const textWidth = ctx.measureText(text).width;
  const boxWidth = textWidth + 18;
  const boxHeight = 23;
  const left = Math.max(4, Math.min(width - boxWidth - 4, x + 16));
  const top = Math.max(4, Math.min(height - boxHeight - 4, y + 16));
  ctx.beginPath();
  ctx.roundRect(left, top, boxWidth, boxHeight, 7);
  ctx.fillStyle = COLOURS.hintBack;
  ctx.fill();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = colour;
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + 9, top + boxHeight / 2);
}

function verdictColour(verdict: LinkVerdict | null): string {
  if (!verdict) {
    return COLOURS.nodeEdgeSelected;
  }
  if (verdict.kind === "ok") {
    return COLOURS.ok;
  }
  if (verdict.kind === "replace") {
    return COLOURS.warn;
  }
  return COLOURS.bad;
}

function verdictText(graph: Graph, drag: LinkDrag): string {
  const source = labelOf(graph, drag.sourceId);
  if (!drag.targetId || !drag.verdict) {
    return `Отпустите на здании, которому нужен «${source}»`;
  }
  const target = labelOf(graph, drag.targetId);
  if (drag.verdict.kind === "ok") {
    return `«${target}» будет требовать «${source}»`;
  }
  if (drag.verdict.kind === "replace") {
    return `Заменит: «${drag.verdict.previousLabel}» → «${source}»`;
  }
  if (drag.verdict.kind === "self") {
    return "Здание не может требовать само себя";
  }
  return `Кольцо: ${drag.verdict.ring.join(" → ")}`;
}

function accentOf(drag: LinkDrag | null, nodeId: string): NodeAccent {
  if (!drag) {
    return null;
  }
  if (nodeId === drag.sourceId) {
    return "source";
  }
  if (nodeId !== drag.targetId || !drag.verdict) {
    return null;
  }
  if (drag.verdict.kind === "ok") {
    return "ok";
  }
  if (drag.verdict.kind === "replace") {
    return "replace";
  }
  return "bad";
}

function edgeStyleOf(edge: GraphEdge, drag: LinkDrag | null, hoveredEdgeTo: string | null): EdgeStyle {
  // The link about to be replaced is struck through, so a swap is visible
  // before the drop rather than after it.
  if (drag && drag.targetId === edge.to && drag.verdict?.kind === "replace") {
    return { colour: COLOURS.bad, width: 2, dashed: true };
  }
  if (!drag && hoveredEdgeTo === edge.to) {
    return { colour: COLOURS.bad, width: 3, dashed: false };
  }
  if (edge.onCycle) {
    return { colour: COLOURS.edgeCycle, width: 2, dashed: false };
  }
  return { colour: COLOURS.edge, width: 2, dashed: false };
}

function draw(canvas: HTMLCanvasElement, graph: Graph, selectedId: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const drag = linkDrag;
  const hoveredEdgeTo = drag ? null : hover.edgeTo;

  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);
  drawGrid(ctx, width, height);

  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) {
      continue;
    }
    drawEdge(ctx, from, to, edgeStyleOf(edge, drag, hoveredEdgeTo));
  }
  for (const node of graph.nodes) {
    drawNode(ctx, node, node.id === selectedId, accentOf(drag, node.id));
  }
  for (const node of graph.nodes) {
    drawHandle(ctx, node, hover.handleId === node.id || drag?.sourceId === node.id);
  }

  if (drag) {
    const source = byId.get(drag.sourceId);
    if (source) {
      const colour = verdictColour(drag.verdict);
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(handleX(source), handleY(source));
      const bend = Math.max(40, Math.abs(drag.x - handleX(source)) * 0.45);
      ctx.bezierCurveTo(handleX(source) + bend, handleY(source), drag.x - bend, drag.y, drag.x, drag.y);
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(drag.x, drag.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
    }
  }

  if (hoveredEdgeTo) {
    const edge = graph.edges.find((item) => item.to === hoveredEdgeTo);
    const from = edge ? byId.get(edge.from) : undefined;
    const to = edge ? byId.get(edge.to) : undefined;
    if (from && to) {
      drawEdgeBadge(ctx, from, to);
    }
  }
  ctx.restore();

  if (drag) {
    drawHint(ctx, width, height, drag.screenX, drag.screenY, verdictText(graph, drag), verdictColour(drag.verdict));
  } else if (hoveredEdgeTo) {
    const hint = `Клик — снять требование с «${labelOf(graph, hoveredEdgeTo)}»`;
    drawHint(ctx, width, height, hover.hintX, hover.hintY, hint, COLOURS.bad);
  }
}

function Canvas(): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    let frame = 0;
    let pointer: Pointer | null = null;

    const paint = (): void => {
      frame = 0;
      draw(canvas, buildGraph(values.peek()), selected.peek());
    };
    // Dirty flag: a frame is asked for on change and nothing runs while idle.
    const schedule = (): void => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(paint);
      }
    };
    const fit = (): void => {
      fitView(buildGraph(values.peek()), wrap.clientWidth, wrap.clientHeight);
      schedule();
    };

    const resize = (): void => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(wrap.clientWidth));
      const height = Math.max(1, Math.round(wrap.clientHeight));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      if (!fitted) {
        fitted = true;
        fit();
        return;
      }
      schedule();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    resize();

    const setCursor = (next: string): void => {
      if (canvas.style.cursor !== next) {
        canvas.style.cursor = next;
      }
    };

    const clearHover = (): void => {
      if (hover.handleId !== null || hover.edgeTo !== null) {
        hover.handleId = null;
        hover.edgeTo = null;
        schedule();
      }
    };

    /** Writes the new prerequisite through the ordinary field path. */
    const dropLink = (graph: Graph, drag: LinkDrag): void => {
      if (!drag.targetId || !drag.verdict) {
        return;
      }
      const source = labelOf(graph, drag.sourceId);
      const target = labelOf(graph, drag.targetId);
      if (drag.verdict.kind === "self") {
        status.value = { kind: "error", text: `«${target}» не может требовать само себя — связь не создана.` };
        return;
      }
      if (drag.verdict.kind === "cycle") {
        status.value = {
          kind: "error",
          text: `Связь не создана — получилось бы кольцо требований: ${drag.verdict.ring.join(" → ")}`,
        };
        return;
      }
      setField(`${BUILDINGS_GROUP}.${drag.targetId}`, PREREQUISITE_FIELD, drag.sourceId);
      selected.value = drag.targetId;
      if (drag.verdict.kind === "replace") {
        status.value = {
          kind: "info",
          text: `«${target}»: требование «${drag.verdict.previousLabel}» заменено на «${source}». Не забудьте сохранить.`,
        };
        return;
      }
      status.value = { kind: "info", text: `«${target}» теперь требует «${source}». Не забудьте сохранить.` };
    };

    const cutLink = (graph: Graph, childId: string): void => {
      setField(`${BUILDINGS_GROUP}.${childId}`, PREREQUISITE_FIELD, NO_PREREQUISITE);
      selected.value = childId;
      status.value = {
        kind: "info",
        text: `«${labelOf(graph, childId)}» доступно с начала игры. Не забудьте сохранить.`,
      };
    };

    const onPointerDown = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const x = toGraphX(event.clientX, rect);
      const y = toGraphY(event.clientY, rect);
      const graph = buildGraph(values.peek());
      capturePointer(canvas, event.pointerId);

      const handle = handleAt(graph, x, y);
      if (handle) {
        linkDrag = {
          sourceId: handle.id,
          x,
          y,
          screenX: event.clientX - rect.left,
          screenY: event.clientY - rect.top,
          targetId: null,
          verdict: null,
        };
        setCursor("crosshair");
        schedule();
        return;
      }

      const hit = nodeAt(graph, x, y);
      if (hit) {
        selected.value = hit.id;
        pointer = {
          mode: "node",
          startX: event.clientX,
          startY: event.clientY,
          viewX: view.x,
          viewY: view.y,
          grabX: x - hit.x,
          grabY: y - hit.y,
          nodeId: hit.id,
          edgeTo: null,
          moved: false,
        };
        setCursor("grabbing");
        return;
      }
      const edge = edgeAt(graph, x, y, EDGE_GRAB);
      pointer = {
        mode: "pan",
        startX: event.clientX,
        startY: event.clientY,
        viewX: view.x,
        viewY: view.y,
        grabX: 0,
        grabY: 0,
        nodeId: "",
        edgeTo: edge ? edge.to : null,
        moved: false,
      };
      setCursor("grabbing");
    };

    const onPointerMove = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const x = toGraphX(event.clientX, rect);
      const y = toGraphY(event.clientY, rect);

      if (linkDrag) {
        const graph = buildGraph(values.peek());
        const target = nodeAt(graph, x, y);
        linkDrag = {
          ...linkDrag,
          x,
          y,
          screenX: event.clientX - rect.left,
          screenY: event.clientY - rect.top,
          targetId: target ? target.id : null,
          verdict: target ? linkVerdict(graph, linkDrag.sourceId, target.id) : null,
        };
        schedule();
        return;
      }

      if (pointer) {
        if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > CLICK_SLOP) {
          pointer.moved = true;
        }
        if (pointer.mode === "pan") {
          view.x = pointer.viewX + (event.clientX - pointer.startX);
          view.y = pointer.viewY + (event.clientY - pointer.startY);
          schedule();
          return;
        }
        const owner = `${BUILDINGS_GROUP}.${pointer.nodeId}`;
        setField(owner, NODE_X_FIELD, Math.round(x - pointer.grabX));
        setField(owner, NODE_Y_FIELD, Math.round(y - pointer.grabY));
        return;
      }

      const graph = buildGraph(values.peek());
      const handle = handleAt(graph, x, y);
      const edge = handle || nodeAt(graph, x, y) ? null : edgeAt(graph, x, y, EDGE_GRAB);
      const nextHandle = handle ? handle.id : null;
      const nextEdge = edge ? edge.to : null;
      hover.hintX = event.clientX - rect.left;
      hover.hintY = event.clientY - rect.top;
      if (nextHandle !== hover.handleId || nextEdge !== hover.edgeTo) {
        hover.handleId = nextHandle;
        hover.edgeTo = nextEdge;
        schedule();
      } else if (nextEdge) {
        schedule();
      }
      if (nextHandle) {
        setCursor("crosshair");
        return;
      }
      setCursor(nextEdge ? "pointer" : "grab");
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (linkDrag) {
        // The target is read from the release, not from the last move: a
        // gesture can end without a move ever landing on the node.
        const rect = canvas.getBoundingClientRect();
        const graph = buildGraph(values.peek());
        const target = nodeAt(graph, toGraphX(event.clientX, rect), toGraphY(event.clientY, rect));
        dropLink(graph, {
          ...linkDrag,
          targetId: target ? target.id : null,
          verdict: target ? linkVerdict(graph, linkDrag.sourceId, target.id) : null,
        });
        linkDrag = null;
        schedule();
      } else if (pointer && pointer.mode === "pan" && pointer.edgeTo && !pointer.moved) {
        cutLink(buildGraph(values.peek()), pointer.edgeTo);
        clearHover();
      }
      pointer = null;
      setCursor("grab");
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };

    const onPointerCancel = (event: PointerEvent): void => {
      linkDrag = null;
      pointer = null;
      setCursor("grab");
      schedule();
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };

    const onPointerLeave = (): void => {
      if (!linkDrag && !pointer) {
        clearHover();
      }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && linkDrag) {
        linkDrag = null;
        schedule();
      }
    };

    // No toolbar button asks for it, so the gesture that costs nothing on
    // screen brings a graph the user panned away back into sight.
    const onDoubleClick = (event: MouseEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const graph = buildGraph(values.peek());
      if (nodeAt(graph, toGraphX(event.clientX, rect), toGraphY(event.clientY, rect))) {
        return;
      }
      fit();
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const graphX = toGraphX(event.clientX, rect);
      const graphY = toGraphY(event.clientY, rect);
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * Math.exp(-event.deltaY * 0.0015)));
      // Keep the point under the cursor still while the scale changes.
      view.x = event.clientX - rect.left - graphX * next;
      view.y = event.clientY - rect.top - graphY * next;
      view.scale = next;
      schedule();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);

    const stop = effect(() => {
      // Subscribes to both signals; the values themselves are read while painting.
      void values.value;
      void selected.value;
      schedule();
    });

    return () => {
      stop();
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("dblclick", onDoubleClick);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      linkDrag = null;
      hover.handleId = null;
      hover.edgeTo = null;
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);

  return (
    <div className="graph-canvas" ref={wrapRef}>
      <canvas ref={canvasRef} />
    </div>
  );
}

/**
 * Fields of the selected building, drawn by the same rows as every other page.
 * The prerequisite is not among them: it is drawn and edited on the canvas.
 */
function Panel(): React.JSX.Element {
  useSignals();
  const entities = entityEntries(BUILDINGS)!;
  const current = selected.value;
  const entity = entities.find(([id]) => id === current)![1];
  const owner = `${BUILDINGS_GROUP}.${current}`;

  return (
    <aside className="graph-panel">
      <header className="entity-head">
        <h3>{entity.label}</h3>
        <span className="muted mono">{owner}</span>
      </header>
      <div className="fields">
        {fieldEntries(BUILDINGS)
          .filter(([key]) => key !== PREREQUISITE_FIELD)
          .map(([key, field]: [string, Field]) => (
            <FieldRow key={key} owner={owner} name={key} field={field} />
          ))}
      </div>
    </aside>
  );
}

function BuildingsGraph(): React.JSX.Element {
  useSignals();
  const graph = buildGraph(values.value);
  const cycleLabels = graph.nodes.filter((node) => node.onCycle).map((node) => node.label);

  return (
    <div className="graph">
      {cycleLabels.length > 0 ? (
        <p className="status error" role="alert">
          Требования зациклены: {cycleLabels.join(", ")}. Такое дерево не сохранится — сервер отклонит запись, пока
          кольцо не разорвано.
        </p>
      ) : null}
      <div className="graph-body">
        <Canvas />
        <Panel />
      </div>
    </div>
  );
}

export { BuildingsGraph };
