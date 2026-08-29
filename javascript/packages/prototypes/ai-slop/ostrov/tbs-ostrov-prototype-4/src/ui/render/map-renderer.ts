import { axialKey, axialNeighbours } from "../../domain/hex/coords";
import { axialToPixel, boundsOfCells, hexEdge, traceHex } from "../../domain/hex/layout";
import { buildPath } from "../../domain/rules/movement";
import { drawStructure, drawTerrainDetail, drawUnitGlyph } from "./icons";
import {
  ATTACK_STROKE,
  COAST_LINE,
  FACTION_STYLE,
  FOG_REMEMBERED,
  FOG_UNSEEN,
  GRID_STROKE,
  HOVER_STROKE,
  OCEAN_BACKDROP,
  PATH_STROKE,
  REACHABLE_FILL,
  SELECTION_STROKE,
  SHALLOW_WATER,
  TERRAIN_STYLE,
  healthColour,
} from "./palette";
import type { TPoint, TRect } from "../../domain/hex/layout";
import type { TMovementMap } from "../../domain/rules/movement";
import type { TArmy, TStructure, TTile, TWorld } from "../../domain/world/types";
import type { TMoveAnimation, TStrikeFlash } from "../../store/store";

/**
 * One pass over the board, back to front. The renderer owns no state: give it
 * the same input twice and it paints the same frame, which is what lets the
 * move animation be a pure function of the clock.
 */

type TRenderInput = {
  world: TWorld;
  armies: readonly TArmy[];
  structures: readonly TStructure[];
  visible: ReadonlySet<string>;
  explored: ReadonlySet<string>;
  selectedArmyId: number;
  movement: TMovementMap | null;
  hoveredKey: string;
  hexSize: number;
  showGrid: boolean;
  showFog: boolean;
  showCoords: boolean;
  move: TMoveAnimation | null;
  strike: TStrikeFlash | null;
  now: number;
};

/** How long a hit marker stays on the tile it landed on. */
const STRIKE_DURATION_MS = 620;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

const shade = (colour: string, factor: number): string => {
  const value = Number.parseInt(colour.slice(1), 16);
  const channel = (shift: number) => Math.min(255, Math.max(0, Math.round(((value >> shift) & 255) * factor)));

  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
};

const centreOf = (world: TWorld, key: string, size: number): TPoint | null => {
  const tile = world.tiles.get(key);

  return tile ? axialToPixel(tile.cell, size) : null;
};

/** Where an army is drawn right now, which is not always where it stands. */
const armyPosition = (input: TRenderInput, army: TArmy): TPoint => {
  const { world, hexSize, move, now } = input;
  const resting = axialToPixel(world.tiles.get(army.key)!.cell, hexSize);
  if (!move || move.armyId !== army.id || move.path.length === 0) {
    return resting;
  }

  const total = move.path.length * move.stepMs;
  const progress = clamp01((now - move.startedAt) / total);
  if (progress >= 1) {
    return resting;
  }

  const walked = progress * move.path.length;
  const index = Math.min(Math.floor(walked), move.path.length - 1);
  const fromKey = index === 0 ? move.fromKey : move.path[index - 1]!;
  const from = centreOf(world, fromKey, hexSize);
  const to = centreOf(world, move.path[index]!, hexSize);
  if (!from || !to) {
    return resting;
  }

  const local = easeInOut(walked - index);

  return { x: from.x + (to.x - from.x) * local, y: from.y + (to.y - from.y) * local };
};

/** The centre a disc is drawn at, dropped clear of a building on the same tile. */
const armyDrawCentre = (input: TRenderInput, army: TArmy): TPoint => {
  const anchor = armyPosition(input, army);
  const stacked = input.structures.some((structure) => structure.key === army.key);

  return { x: anchor.x, y: anchor.y + (stacked ? input.hexSize * 0.28 : 0) };
};

const isHidden = (input: TRenderInput, key: string): boolean => input.showFog && !input.explored.has(key);

const isRemembered = (input: TRenderInput, key: string): boolean =>
  input.showFog && input.explored.has(key) && !input.visible.has(key);

const drawTile = (context: CanvasRenderingContext2D, input: TRenderInput, tile: TTile) => {
  const centre = axialToPixel(tile.cell, input.hexSize);

  if (isHidden(input, tile.key)) {
    traceHex(context, centre, input.hexSize);
    context.fillStyle = FOG_UNSEEN;
    context.fill();

    return;
  }

  const style = TERRAIN_STYLE[tile.terrain];
  const lift = tile.terrain === "sea" ? (tile.coastal ? 1.16 : 1) : 0.92 + tile.elevation * 0.24;

  traceHex(context, centre, input.hexSize);
  context.fillStyle = tile.terrain === "sea" && tile.coastal ? SHALLOW_WATER : shade(style.fill, lift);
  context.fill();

  drawTerrainDetail(context, tile, centre, input.hexSize);
};

/** The bright line where the island meets the water. */
const drawCoastline = (context: CanvasRenderingContext2D, input: TRenderInput) => {
  context.strokeStyle = COAST_LINE;
  context.lineWidth = Math.max(1.5, input.hexSize * 0.07);
  context.lineCap = "round";

  for (const tile of input.world.order) {
    if (tile.terrain === "sea" || isHidden(input, tile.key)) {
      continue;
    }

    const centre = axialToPixel(tile.cell, input.hexSize);
    axialNeighbours(tile.cell).forEach((neighbour, direction) => {
      const neighbourTile = input.world.tiles.get(axialKey(neighbour.q, neighbour.r));
      if (neighbourTile && neighbourTile.terrain !== "sea") {
        return;
      }

      const [start, end] = hexEdge(centre, input.hexSize, direction);
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    });
  }
};

const drawGrid = (context: CanvasRenderingContext2D, input: TRenderInput) => {
  context.strokeStyle = GRID_STROKE;
  context.lineWidth = 1;

  for (const tile of input.world.order) {
    traceHex(context, axialToPixel(tile.cell, input.hexSize), input.hexSize);
    context.stroke();
  }
};

/** Where the selected army may go, and what it may hit from there. */
const drawMovementOverlay = (context: CanvasRenderingContext2D, input: TRenderInput) => {
  const { movement, hexSize } = input;
  if (!movement) {
    return;
  }

  for (const key of movement.destinations) {
    const centre = centreOf(input.world, key, hexSize);
    if (!centre || isHidden(input, key)) {
      continue;
    }
    traceHex(context, centre, hexSize * 0.94);
    context.fillStyle = REACHABLE_FILL;
    context.fill();
  }

  context.lineWidth = Math.max(2, hexSize * 0.08);
  context.strokeStyle = ATTACK_STROKE;
  for (const key of movement.attacks.keys()) {
    const centre = centreOf(input.world, key, hexSize);
    if (!centre || isHidden(input, key)) {
      continue;
    }
    traceHex(context, centre, hexSize * 0.88);
    context.stroke();
  }
};

/** The dotted route to whatever the pointer is over, with its cost. */
const drawHoverPath = (context: CanvasRenderingContext2D, input: TRenderInput) => {
  const { movement, hoveredKey, hexSize } = input;
  const selected = input.armies.find((army) => army.id === input.selectedArmyId);
  if (!movement || !selected || hoveredKey === "") {
    return;
  }

  const targetKey = movement.attacks.get(hoveredKey) ?? (movement.destinations.has(hoveredKey) ? hoveredKey : null);
  if (!targetKey) {
    return;
  }

  const path = buildPath(movement.cameFrom, selected.key, targetKey);
  if (path.length === 0) {
    return;
  }

  const points = [selected.key, ...path].map((key) => centreOf(input.world, key, hexSize)).filter((point) => point !== null);

  context.save();
  context.setLineDash([hexSize * 0.16, hexSize * 0.14]);
  context.strokeStyle = PATH_STROKE;
  context.lineWidth = Math.max(2, hexSize * 0.07);
  context.lineJoin = "round";
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  });
  context.stroke();
  context.restore();

  const last = points[points.length - 1]!;
  const cost = movement.costs.get(targetKey) ?? 0;
  const badge = `${cost}/${selected.movementLeft}`;
  context.font = `600 ${Math.round(hexSize * 0.28)}px "Inter", system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const width = context.measureText(badge).width + hexSize * 0.22;

  context.fillStyle = "rgba(10, 24, 34, 0.85)";
  context.beginPath();
  context.roundRect(last.x - width / 2, last.y - hexSize * 0.86, width, hexSize * 0.34, hexSize * 0.1);
  context.fill();
  context.fillStyle = "#f4ecd4";
  context.fillText(badge, last.x, last.y - hexSize * 0.68);
};

/** Armies the player can actually see. Also decides what stacks with what. */
const shownArmyKeys = (input: TRenderInput): Set<string> =>
  new Set(input.armies.filter((army) => !input.showFog || input.visible.has(army.key)).map((army) => army.key));

/**
 * A garrison stands on its own city, so the two share a tile. The building
 * moves up and the disc moves down rather than one hiding the other.
 */
const drawStructures = (context: CanvasRenderingContext2D, input: TRenderInput) => {
  const stackedKeys = shownArmyKeys(input);

  for (const structure of input.structures) {
    if (isHidden(input, structure.key)) {
      continue;
    }

    const anchor = centreOf(input.world, structure.key, input.hexSize);
    if (!anchor) {
      continue;
    }

    const stacked = stackedKeys.has(structure.key);
    const size = input.hexSize * (stacked ? 0.76 : 1);
    const centre = { x: anchor.x, y: anchor.y - (stacked ? input.hexSize * 0.3 : 0) };

    context.save();
    if (structure.hp <= 0) {
      context.globalAlpha = 0.35;
    }
    drawStructure(context, structure.kind, centre, size, FACTION_STYLE[structure.owner]);
    context.restore();

    drawHealthBar(context, centre, size * 0.86, size, structure.hp / structure.maxHp);
  }
};

const drawHealthBar = (
  context: CanvasRenderingContext2D,
  centre: TPoint,
  offsetY: number,
  size: number,
  fraction: number
) => {
  const width = size * 0.84;
  const height = Math.max(3, size * 0.1);
  const x = centre.x - width / 2;
  const y = centre.y + offsetY - height;

  context.fillStyle = "rgba(8, 20, 28, 0.75)";
  context.beginPath();
  context.roundRect(x - 1, y - 1, width + 2, height + 2, height);
  context.fill();

  context.fillStyle = healthColour(fraction);
  context.beginPath();
  context.roundRect(x, y, Math.max(width * clamp01(fraction), height), height, height);
  context.fill();
};

const drawArmies = (context: CanvasRenderingContext2D, input: TRenderInput) => {
  const structureKeys = new Set(input.structures.map((structure) => structure.key));

  for (const army of input.armies) {
    if (input.showFog && !input.visible.has(army.key)) {
      continue;
    }

    const radius = input.hexSize * (structureKeys.has(army.key) ? 0.33 : 0.42);
    const centre = armyDrawCentre(input, army);
    const style = FACTION_STYLE[army.owner];
    const spent = army.owner === "player" && (army.movementLeft <= 0 || army.hasAttacked);

    context.save();
    context.globalAlpha = spent ? 0.55 : 1;

    context.shadowColor = "rgba(6, 16, 24, 0.5)";
    context.shadowBlur = input.hexSize * 0.16;
    context.shadowOffsetY = input.hexSize * 0.05;
    context.beginPath();
    context.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
    context.fillStyle = style.fill;
    context.fill();
    context.shadowColor = "transparent";

    context.lineWidth = Math.max(1.5, radius * 0.14);
    context.strokeStyle = style.stroke;
    context.stroke();

    drawUnitGlyph(context, army.kind, centre, radius, style.ink);
    context.restore();

    drawHealthBar(context, centre, radius + input.hexSize * 0.24, input.hexSize, army.hp / army.maxHp);
  }
};

/** A ring that pulses around the army in hand. */
const drawSelection = (context: CanvasRenderingContext2D, input: TRenderInput) => {
  const selected = input.armies.find((army) => army.id === input.selectedArmyId);
  if (!selected) {
    return;
  }

  const centre = armyDrawCentre(input, selected);
  const pulse = 1 + Math.sin(input.now / 260) * 0.06;

  context.save();
  context.strokeStyle = SELECTION_STROKE;
  context.lineWidth = Math.max(2, input.hexSize * 0.075);
  context.setLineDash([input.hexSize * 0.2, input.hexSize * 0.14]);
  context.lineDashOffset = -input.now / 28;
  context.beginPath();
  context.arc(centre.x, centre.y, input.hexSize * 0.56 * pulse, 0, Math.PI * 2);
  context.stroke();
  context.restore();
};

const drawHover = (context: CanvasRenderingContext2D, input: TRenderInput) => {
  if (input.hoveredKey === "" || isHidden(input, input.hoveredKey)) {
    return;
  }

  const centre = centreOf(input.world, input.hoveredKey, input.hexSize);
  if (!centre) {
    return;
  }

  traceHex(context, centre, input.hexSize * 0.96);
  context.strokeStyle = HOVER_STROKE;
  context.lineWidth = Math.max(1.5, input.hexSize * 0.05);
  context.stroke();
};

/** The damage number that floats off a tile the moment it is hit. */
const drawStrike = (context: CanvasRenderingContext2D, input: TRenderInput) => {
  const { strike, hexSize, now } = input;
  if (!strike || now < strike.startAt || now > strike.startAt + STRIKE_DURATION_MS) {
    return;
  }

  const centre = centreOf(input.world, strike.key, hexSize);
  if (!centre) {
    return;
  }

  const progress = clamp01((now - strike.startAt) / STRIKE_DURATION_MS);

  context.save();
  context.globalAlpha = 1 - progress;
  context.strokeStyle = ATTACK_STROKE;
  context.lineWidth = Math.max(2, hexSize * 0.09) * (1 - progress);
  context.beginPath();
  context.arc(centre.x, centre.y, hexSize * (0.3 + progress * 0.6), 0, Math.PI * 2);
  context.stroke();

  context.font = `700 ${Math.round(hexSize * 0.4)}px "Inter", system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = strike.fatal ? "#ffd75e" : "#ffece8";
  context.fillText(`−${strike.damage}`, centre.x, centre.y - hexSize * (0.4 + progress * 0.5));
  context.restore();
};

/** Dims everything the player remembers but cannot currently see. */
const drawFog = (context: CanvasRenderingContext2D, input: TRenderInput) => {
  if (!input.showFog) {
    return;
  }

  context.fillStyle = FOG_REMEMBERED;
  for (const tile of input.world.order) {
    if (!isRemembered(input, tile.key)) {
      continue;
    }
    traceHex(context, axialToPixel(tile.cell, input.hexSize), input.hexSize);
    context.fill();
  }
};

const drawCoords = (context: CanvasRenderingContext2D, input: TRenderInput) => {
  if (!input.showCoords) {
    return;
  }

  context.font = `500 ${Math.round(input.hexSize * 0.24)}px "Inter", system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(255, 255, 255, 0.6)";

  for (const tile of input.world.order) {
    const centre = axialToPixel(tile.cell, input.hexSize);
    context.fillText(`${tile.cell.q},${tile.cell.r}`, centre.x, centre.y + input.hexSize * 0.66);
  }
};

/**
 * World-space rectangle the board occupies. The canvas is sized to it and the
 * pointer is mapped back through it, so both live off the same numbers.
 */
const boardBounds = (world: TWorld, hexSize: number): TRect =>
  boundsOfCells(
    world.order.map((tile) => tile.cell),
    hexSize,
    hexSize * 0.55
  );

/** Sizes the canvas to the board and returns the rectangle it drew into. */
const prepareCanvas = (canvas: HTMLCanvasElement, input: TRenderInput): TRect => {
  const bounds = boardBounds(input.world, input.hexSize);
  const ratio = window.devicePixelRatio || 1;

  canvas.width = Math.round(bounds.width * ratio);
  canvas.height = Math.round(bounds.height * ratio);
  canvas.style.width = `${Math.round(bounds.width)}px`;
  canvas.style.height = `${Math.round(bounds.height)}px`;

  return bounds;
};

const drawMap = (canvas: HTMLCanvasElement, input: TRenderInput) => {
  const bounds = prepareCanvas(canvas, input);
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const ratio = window.devicePixelRatio || 1;
  context.setTransform(ratio, 0, 0, ratio, -bounds.minX * ratio, -bounds.minY * ratio);
  context.fillStyle = OCEAN_BACKDROP;
  context.fillRect(bounds.minX, bounds.minY, bounds.width, bounds.height);

  for (const tile of input.world.order) {
    drawTile(context, input, tile);
  }

  drawCoastline(context, input);
  if (input.showGrid) {
    drawGrid(context, input);
  }

  drawFog(context, input);
  drawMovementOverlay(context, input);
  drawHover(context, input);
  drawHoverPath(context, input);
  drawStructures(context, input);
  drawArmies(context, input);
  drawSelection(context, input);
  drawStrike(context, input);
  drawCoords(context, input);
};

export type { TRenderInput };
export { STRIKE_DURATION_MS, boardBounds, drawMap };
