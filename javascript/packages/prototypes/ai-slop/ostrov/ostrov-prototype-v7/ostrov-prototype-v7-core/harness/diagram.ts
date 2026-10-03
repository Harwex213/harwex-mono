import { metrics } from "./layout";
import { tokenize } from "./syntax";
import { edgeThemes, nodeThemes, palette, syntaxThemes } from "./theme";
import type { Box, Layout, Point, RoutedEdge } from "./layout";
import type { Camera } from "./camera";
import type { Token } from "./syntax";

type Highlight = {
  active: string | undefined;
  selected: string | undefined;
  query: string;
};

type Paint = {
  ctx: CanvasRenderingContext2D;
  layout: Layout;
  camera: Camera;
  size: Point;
  highlight: Highlight;
};

const detailScale = 0.3;
const dim = 0.18;

const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void => {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
};

const ellipsis = (ctx: CanvasRenderingContext2D, text: string, width: number): string => {
  if (ctx.measureText(text).width <= width) {
    return text;
  }

  let cut = text;

  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) {
    cut = cut.slice(0, -1);
  }

  return `${cut}…`;
};

const paintGrid = (paint: Paint): void => {
  const { ctx, camera, size } = paint;
  const step = 40 * camera.scale;

  if (step < 12) {
    return;
  }

  const origin = camera.toWorld({
    x: 0,
    y: 0,
  });

  const startX = -(((origin.x % 40) + 40) % 40) * camera.scale;
  const startY = -(((origin.y % 40) + 40) % 40) * camera.scale;

  ctx.save();
  ctx.fillStyle = palette.grid;

  for (let y = startY; y < size.y; y += step) {
    for (let x = startX; x < size.x; x += step) {
      ctx.fillRect(x, y, 1, 1);
    }
  }

  ctx.restore();
};

const neighboursOf = (layout: Layout, id: string | undefined): Set<string> => {
  const related = new Set<string>();

  if (!id) {
    return related;
  }

  related.add(id);

  for (const routed of layout.edges) {
    if (routed.edge.from === id) {
      related.add(routed.edge.to);
    }

    if (routed.edge.to === id) {
      related.add(routed.edge.from);
    }
  }

  return related;
};

const matches = (box: Box, query: string): boolean => {
  if (!query) {
    return true;
  }

  const needle = query.toLowerCase();

  if (box.node.id.toLowerCase().includes(needle)) {
    return true;
  }

  const members = [...box.node.fields, ...box.node.properties].some((field) => {
    return field.name.toLowerCase().includes(needle);
  });

  return (
    members ||
    box.node.methods.some((method) => {
      return method.name.toLowerCase().includes(needle);
    })
  );
};

// The curve arrives flat, so the head is a triangle along the same axis.
const paintArrow = (ctx: CanvasRenderingContext2D, to: Point, direction: number): void => {
  const length = 9;
  const half = 4.5;

  ctx.beginPath();
  ctx.moveTo(to.x + length * direction, to.y);
  ctx.lineTo(to.x, to.y - half);
  ctx.lineTo(to.x, to.y + half);
  ctx.closePath();
  ctx.fill();
};

const paintEdge = (ctx: CanvasRenderingContext2D, routed: RoutedEdge, strong: boolean): void => {
  const color = edgeThemes[routed.edge.kind];
  const reach = Math.max(40, Math.abs(routed.to.x - routed.from.x) * 0.45);
  const direction = routed.back ? -1 : 1;
  const c1 = {
    x: routed.from.x + reach * direction,
    y: routed.from.y,
  };
  const c2 = {
    x: routed.to.x - reach * direction,
    y: routed.to.y,
  };

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = strong ? 2.4 : 1.4;

  ctx.beginPath();
  ctx.moveTo(routed.from.x, routed.from.y);
  ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, routed.to.x, routed.to.y);
  ctx.stroke();
  paintArrow(ctx, routed.to, direction);
  ctx.restore();
};

const paintHeader = (ctx: CanvasRenderingContext2D, box: Box): void => {
  const theme = nodeThemes[box.node.kind];
  const width = box.width - metrics.padding * 2;

  ctx.save();
  roundRect(ctx, box.x, box.y, box.width, box.headHeight, 12);
  ctx.clip();
  ctx.fillStyle = theme.head;
  ctx.fillRect(box.x, box.y, box.width, box.headHeight);
  ctx.restore();

  ctx.fillStyle = theme.title;
  ctx.font = metrics.titleFont;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.fillText(ellipsis(ctx, box.node.id, width), box.x + box.width / 2, box.y + 24);
  ctx.textAlign = "left";
};

// Draws a signature left to right and stops at the edge of the card.
const paintTokens = (
  ctx: CanvasRenderingContext2D,
  tokens: Token[],
  x: number,
  y: number,
  maxWidth: number,
  typeColor: string,
): void => {
  let cursor = x;

  for (const token of tokens) {
    const width = ctx.measureText(token.text).width;

    if (cursor + width > x + maxWidth) {
      ctx.fillStyle = syntaxThemes.punct;
      ctx.fillText("…", cursor, y);

      return;
    }

    ctx.fillStyle = token.role === "type" ? typeColor : syntaxThemes[token.role];
    ctx.fillText(token.text, cursor, y);
    cursor += width;
  }
};

const paintBody = (ctx: CanvasRenderingContext2D, box: Box): void => {
  const theme = nodeThemes[box.node.kind];
  const left = box.x + metrics.padding;
  const right = box.x + box.width - metrics.padding;
  const width = box.width - metrics.padding * 2;

  if (box.doc.length > 0) {
    let line = box.y + box.headHeight + 14;

    ctx.font = metrics.docFont;
    ctx.fillStyle = palette.muted;

    for (const text of box.doc) {
      ctx.fillText(text, left, line);
      line += metrics.docLineHeight;
    }
  }

  for (const row of box.rows) {
    const y = box.y + row.end;

    if (row.kind === "section") {
      ctx.font = metrics.sectionFont;
      ctx.fillStyle = palette.faint;
      ctx.textAlign = "left";
      ctx.fillText(row.left.toUpperCase(), left, y - 6);

      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left + ctx.measureText(row.left.toUpperCase()).width + 8, y - 9.5);
      ctx.lineTo(right, y - 9.5);
      ctx.stroke();

      continue;
    }

    ctx.font = metrics.rowFont;

    if (row.right) {
      // The name keeps its place, the type takes what is left of the row.
      const nameWidth = Math.min(ctx.measureText(row.left).width, width * 0.6);
      const typeText = ellipsis(ctx, row.right, Math.max(40, width - nameWidth - 14));

      ctx.textAlign = "right";
      ctx.fillStyle = theme.label;
      ctx.fillText(typeText, right, y - 4);

      ctx.textAlign = "left";
      ctx.fillStyle = palette.text;
      ctx.fillText(ellipsis(ctx, row.left, width - ctx.measureText(typeText).width - 14), left, y - 4);

      continue;
    }

    ctx.textAlign = "left";
    paintTokens(ctx, tokenize(row.left), left, y - 4, width, theme.label);
  }

  ctx.textAlign = "left";
};

const paintBox = (ctx: CanvasRenderingContext2D, box: Box, state: "normal" | "active" | "selected", detailed: boolean): void => {
  const theme = nodeThemes[box.node.kind];
  // Zoomed out the card is the header alone, so the body leaves no empty frame.
  const height = detailed ? box.height : box.headHeight;

  ctx.save();

  if (state !== "normal") {
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
  }

  roundRect(ctx, box.x, box.y, box.width, height, 12);
  ctx.fillStyle = theme.fill;
  ctx.fill();
  ctx.restore();

  paintHeader(ctx, box);

  if (detailed) {
    paintBody(ctx, box);
  }

  roundRect(ctx, box.x + 0.5, box.y + 0.5, box.width - 1, height - 1, 12);
  ctx.strokeStyle = state === "normal" ? theme.line : theme.label;
  ctx.lineWidth = state === "selected" ? 2.5 : state === "active" ? 2 : 1;
  ctx.stroke();
};

const paintDiagram = (paint: Paint): void => {
  const { ctx, layout, camera, size, highlight } = paint;

  ctx.save();
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, size.x, size.y);
  paintGrid(paint);

  camera.apply(ctx);

  const focus = highlight.active ?? highlight.selected;
  const related = neighboursOf(layout, focus);
  const detailed = camera.scale >= detailScale;

  const visible = (id: string): boolean => {
    if (!focus) {
      return true;
    }

    return related.has(id);
  };

  for (const routed of layout.edges) {
    const strong = Boolean(focus) && (routed.edge.from === focus || routed.edge.to === focus);

    ctx.globalAlpha = !focus || strong ? 1 : dim;
    paintEdge(ctx, routed, strong);
  }

  for (const box of layout.boxes) {
    const found = matches(box, highlight.query);
    const state =
      box.node.id === highlight.selected
        ? "selected"
        : box.node.id === highlight.active
          ? "active"
          : "normal";

    ctx.globalAlpha = (visible(box.node.id) ? 1 : dim) * (found ? 1 : 0.25);
    paintBox(ctx, box, state, detailed);

    if (highlight.query && found) {
      ctx.save();
      ctx.globalAlpha = 1;
      roundRect(ctx, box.x - 4.5, box.y - 4.5, box.width + 9, box.height + 9, 15);
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
};

const boxAt = (layout: Layout, point: Point): Box | undefined => {
  for (let index = layout.boxes.length - 1; index >= 0; index -= 1) {
    const box = layout.boxes[index];

    if (!box) {
      continue;
    }

    const inside =
      point.x >= box.x &&
      point.x <= box.x + box.width &&
      point.y >= box.y &&
      point.y <= box.y + box.height;

    if (inside) {
      return box;
    }
  }

  return undefined;
};

export { boxAt, paintDiagram };
export type { Highlight };
