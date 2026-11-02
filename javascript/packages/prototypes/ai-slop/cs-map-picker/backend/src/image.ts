import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";
import type { Image, SKRSContext2D } from "@napi-rs/canvas";
import { findMap } from "./maps.ts";
import type { TPickView } from "./view.ts";
import type { TActionKind, TSide } from "./veto.ts";

const WIDTH = 1200;
const HEIGHT = 675;
const PAD = 48;
// The font ships with the app: the slim container image has no system fonts at all.
const FONTS_DIR = new URL("../assets/fonts/", import.meta.url);
GlobalFonts.registerFromPath(fileURLToPath(new URL("Inter-Regular.ttf", FONTS_DIR)), "Inter");
GlobalFonts.registerFromPath(fileURLToPath(new URL("Inter-SemiBold.ttf", FONTS_DIR)), "Inter");
const FONT = "Inter";

const COLORS = {
  background: "#0d1015",
  text: "#f2f4f8",
  muted: "#8b93a7",
  ban: "#e5484d",
  pick: "#46a758",
  decider: "#f5a524",
};

const MAPS_DIR = new URL("../assets/maps/", import.meta.url);

const loadArt = async (mapId: string) => {
  const file = new URL(`${mapId}.jpg`, MAPS_DIR);
  if (!existsSync(file)) {
    return null;
  }
  return loadImage(fileURLToPath(file));
};

const teamName = (pick: TPickView, side: TSide) => {
  return side === "a" ? pick.teamA.name : pick.teamB.name;
};

const mapName = (mapId: string) => {
  return findMap(mapId)?.name ?? mapId;
};

// Shrinks the font until the text fits, then cuts it with an ellipsis.
const fitText = (ctx: SKRSContext2D, text: string, weight: string, size: number, maxWidth: number, minSize = size * 0.6) => {
  let current = size;
  ctx.font = `${weight} ${current}px ${FONT}`;
  while (ctx.measureText(text).width > maxWidth && current > minSize) {
    current -= 1;
    ctx.font = `${weight} ${current}px ${FONT}`;
  }
  let cut = text;
  while (ctx.measureText(cut).width > maxWidth && cut.length > 1) {
    cut = cut.slice(0, -2) + "…";
  }
  return cut;
};

// Fills the box with the art, cropped like CSS object-fit: cover. A missing art file gets a gradient.
const drawArt = (ctx: SKRSContext2D, art: Image | null, x: number, y: number, w: number, h: number, dim: boolean) => {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);
  ctx.clip();

  if (art) {
    const scale = Math.max(w / art.width, h / art.height);
    const sw = w / scale;
    const sh = h / scale;
    if (dim) {
      ctx.filter = "grayscale(1)";
    }
    ctx.drawImage(art, (art.width - sw) / 2, (art.height - sh) / 2, sw, sh, x, y, w, h);
    ctx.filter = "none";
  } else {
    const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
    gradient.addColorStop(0, "#2a3140");
    gradient.addColorStop(1, "#151a22");
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, w, h);
  }

  const shade = ctx.createLinearGradient(0, y, 0, y + h);
  shade.addColorStop(0, dim ? "rgba(8,10,14,0.55)" : "rgba(8,10,14,0.15)");
  shade.addColorStop(1, dim ? "rgba(8,10,14,0.92)" : "rgba(8,10,14,0.85)");
  ctx.fillStyle = shade;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
};

const drawBadge = (ctx: SKRSContext2D, text: string, color: string, x: number, y: number, size: number) => {
  ctx.font = `700 ${size}px ${FONT}`;
  const w = ctx.measureText(text).width + size * 1.2;
  const h = size * 1.8;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = "#0d1015";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + size * 0.6, y + h / 2 + 1);
  ctx.textBaseline = "alphabetic";
};

const KIND_LABEL: Record<TActionKind, string> = {
  ban: "БАН",
  pick: "ПИК",
};

const renderPickImage = async (pick: TPickView) => {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  const arts = new Map<string, Image | null>();
  for (const map of [...pick.actions.map((action) => action.map), ...pick.playOrder]) {
    if (!arts.has(map)) {
      arts.set(map, await loadArt(map));
    }
  }

  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#151a24");
  background.addColorStop(1, COLORS.background);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Header: format line, then the match-up.
  ctx.fillStyle = COLORS.decider;
  ctx.font = `700 18px ${FONT}`;
  ctx.fillText(pick.format === "bo3" ? "CS2 · ВЫБОР КАРТ · ФИНАЛ BO3" : "CS2 · ВЫБОР КАРТ · BO1", PAD, 62);

  const title = `${pick.teamA.name}  vs  ${pick.teamB.name}`;
  ctx.fillStyle = COLORS.text;
  ctx.fillText(fitText(ctx, title, "800", 50, WIDTH - PAD * 2), PAD, 118);

  // Maps to play, in order.
  const mainTop = 150;
  const mainHeight = 290;
  const gap = 24;
  const cardWidth = (WIDTH - PAD * 2 - gap * (pick.playOrder.length - 1)) / pick.playOrder.length;
  pick.playOrder.forEach((mapId, index) => {
    const x = PAD + index * (cardWidth + gap);
    drawArt(ctx, arts.get(mapId) ?? null, x, mainTop, cardWidth, mainHeight, false);

    const pickAction = pick.actions.find((action) => action.kind === "pick" && action.map === mapId);
    const isDecider = mapId === pick.decider;
    const prefix = pick.playOrder.length > 1 ? `КАРТА ${index + 1} · ` : "";
    const deciderLabel = pick.playOrder.length > 1 ? "РЕШАЮЩАЯ" : "ИГРАЕМ ЗДЕСЬ";
    const label = isDecider ? `${prefix}${deciderLabel}` : `${prefix}ПИК ${pickAction ? teamName(pick, pickAction.side) : ""}`;
    drawBadge(ctx, fitText(ctx, label, "700", 16, cardWidth - 60), isDecider ? COLORS.decider : COLORS.pick, x + 18, mainTop + 18, 16);

    ctx.fillStyle = COLORS.text;
    ctx.fillText(fitText(ctx, mapName(mapId), "800", pick.playOrder.length > 1 ? 44 : 72, cardWidth - 36), x + 20, mainTop + mainHeight - 26);
  });

  // The whole veto, step by step, with the decider at the end.
  const stripTop = 470;
  const stripHeight = 120;
  const tileGap = 12;
  const tiles = [...pick.actions.map((action) => ({ ...action, decider: false })), ...(pick.decider ? [{ map: pick.decider, decider: true, kind: null, side: null }] : [])];
  const tileWidth = (WIDTH - PAD * 2 - tileGap * (tiles.length - 1)) / tiles.length;
  tiles.forEach((tile, index) => {
    const x = PAD + index * (tileWidth + tileGap);
    const isBan = tile.kind === "ban";
    drawArt(ctx, arts.get(tile.map) ?? null, x, stripTop, tileWidth, stripHeight, isBan);

    const color = tile.decider ? COLORS.decider : isBan ? COLORS.ban : COLORS.pick;
    drawBadge(ctx, tile.decider ? "DECIDER" : `${index + 1} · ${KIND_LABEL[tile.kind ?? "ban"]}`, color, x + 10, stripTop + 10, 12);

    ctx.fillStyle = isBan ? COLORS.muted : COLORS.text;
    ctx.fillText(fitText(ctx, mapName(tile.map), "800", 20, tileWidth - 20, 13), x + 10, stripTop + stripHeight - 32);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(fitText(ctx, tile.side ? teamName(pick, tile.side) : "остаётся", "500", 13, tileWidth - 20, 10), x + 10, stripTop + stripHeight - 12);

    if (isBan) {
      ctx.strokeStyle = "rgba(229,72,77,0.8)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + tileWidth - 34, stripTop + 14);
      ctx.lineTo(x + tileWidth - 14, stripTop + 34);
      ctx.moveTo(x + tileWidth - 14, stripTop + 14);
      ctx.lineTo(x + tileWidth - 34, stripTop + 34);
      ctx.stroke();
    }
  });

  // Footer: the coin toss and the date.
  ctx.fillStyle = COLORS.muted;
  ctx.font = `500 16px ${FONT}`;
  if (pick.firstSide) {
    ctx.fillText(`Монетка: первым банит ${teamName(pick, pick.firstSide)}`, PAD, HEIGHT - 40);
  }
  const date = new Date(pick.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  ctx.textAlign = "right";
  ctx.fillText(date, WIDTH - PAD, HEIGHT - 40);
  ctx.textAlign = "left";

  return canvas.encode("png");
};

export { renderPickImage };
