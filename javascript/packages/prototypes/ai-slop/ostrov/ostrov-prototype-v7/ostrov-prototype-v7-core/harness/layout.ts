import { signatureOf } from "./model";
import type { Model, ModelEdge, ModelNode } from "./model";

type Point = {
  x: number;
  y: number;
};

type Row = {
  kind: "section" | "member";
  name: string;
  left: string;
  right: string;
  // Distance from the top of the card to the bottom of the row. The painter and
  // the router both read it, so a row is measured once.
  end: number;
};

type Box = {
  node: ModelNode;
  rows: Row[];
  doc: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  headHeight: number;
  docHeight: number;
};

type RoutedEdge = {
  edge: ModelEdge;
  from: Point;
  to: Point;
  back: boolean;
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Layout = {
  boxes: Box[];
  edges: RoutedEdge[];
  bounds: Rect;
};

type LayoutOptions = {
  positions?: Map<string, Point>;
};



const metrics = {
  padding: 12,
  titleFont: "600 15px system-ui, -apple-system, Segoe UI, sans-serif",
  metaFont: "11px system-ui, -apple-system, Segoe UI, sans-serif",
  docFont: "11px system-ui, -apple-system, Segoe UI, sans-serif",
  rowFont: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
  sectionFont: "600 10px system-ui, -apple-system, Segoe UI, sans-serif",
  rowHeight: 17,
  sectionHeight: 21,
  docLineHeight: 14,
  minWidth: 230,
  maxWidth: 430,
  gapX: 120,
  gapY: 34,
  arrowGap: 7,
};

const ruler = (): CanvasRenderingContext2D => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas 2d context is not available");
  }

  return ctx;
};

// A class shows what the layer above can call: its getters and its methods. The
// private state behind them stays in the panel. A type is nothing but its
// members, so they need no heading either.
const rowsOf = (node: ModelNode): Row[] => {
  const rows: Row[] = [];

  if (node.kind === "type") {
    for (const field of node.fields) {
      rows.push({
        kind: "member",
        name: field.name,
        left: field.name,
        right: field.type,
        end: 0,
      });
    }
  }

  if (node.properties.length > 0) {
    rows.push({
      kind: "section",
      name: "",
      left: "свойства",
      right: "",
      end: 0,
    });

    for (const property of node.properties) {
      rows.push({
        kind: "member",
        name: property.name,
        left: property.name,
        right: property.type,
        end: 0,
      });
    }
  }

  if (node.methods.length > 0) {
    rows.push({
      kind: "section",
      name: "",
      left: "методы",
      right: "",
      end: 0,
    });

    for (const method of node.methods) {
      rows.push({
        kind: "member",
        name: method.name,
        left: signatureOf(method),
        right: "",
        end: 0,
      });
    }
  }

  return rows;
};

const wrap = (ctx: CanvasRenderingContext2D, text: string, width: number): string[] => {
  if (!text) {
    return [];
  }

  ctx.font = metrics.docFont;

  const lines: string[] = [];
  let current = "";

  for (const word of text.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;

    if (ctx.measureText(candidate).width > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }

  if (lines.length <= 3) {
    return lines;
  }

  const kept = lines.slice(0, 3);

  kept[2] = `${kept[2]}…`;

  return kept;
};

const measure = (ctx: CanvasRenderingContext2D, node: ModelNode): Box => {
  const rows = rowsOf(node);
  const inner = metrics.padding * 2;

  ctx.font = metrics.titleFont;
  let width = ctx.measureText(node.id).width;

  for (const row of rows) {
    ctx.font = row.kind === "section" ? metrics.sectionFont : metrics.rowFont;
    const gap = row.right ? 14 : 0;
    const right = row.right ? ctx.measureText(row.right).width : 0;

    width = Math.max(width, ctx.measureText(row.left).width + gap + right);
  }

  width = Math.min(metrics.maxWidth, Math.max(metrics.minWidth, Math.ceil(width) + inner));

  const doc = wrap(ctx, node.doc, width - inner);
  const headHeight = 36;
  const docHeight = doc.length > 0 ? doc.length * metrics.docLineHeight + 18 : 6;
  let cursor = headHeight + docHeight;

  for (const row of rows) {
    cursor += row.kind === "section" ? metrics.sectionHeight : metrics.rowHeight;
    row.end = cursor;
  }

  return {
    node,
    rows,
    doc,
    x: 0,
    y: 0,
    width,
    height: cursor + metrics.padding,
    headHeight,
    docHeight,
  };
};

// A node sits one column to the right of everything that depends on it. The
// roots — the classes nobody imports — end up in the leftmost column.
const rankOf = (nodes: ModelNode[], edges: ModelEdge[]): Map<string, number> => {
  const ranks = new Map<string, number>();

  for (const node of nodes) {
    ranks.set(node.id, 0);
  }

  // Relaxation, capped by the node count: a cycle stops instead of spinning.
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let moved = false;

    for (const edge of edges) {
      const from = ranks.get(edge.from);
      const to = ranks.get(edge.to);

      if (from === undefined || to === undefined) {
        continue;
      }

      if (to < from + 1) {
        ranks.set(edge.to, from + 1);
        moved = true;
      }
    }

    if (!moved) {
      break;
    }
  }

  return ranks;
};

const place = (boxes: Box[], edges: ModelEdge[]): void => {
  const nodes = boxes.map((box) => {
    return box.node;
  });

  const ranks = rankOf(nodes, edges);
  const columns = new Map<number, Box[]>();

  for (const box of boxes) {
    const rank = ranks.get(box.node.id) ?? 0;
    const column = columns.get(rank) ?? [];

    column.push(box);
    columns.set(rank, column);
  }

  const order = [...columns.keys()].sort((a, b) => {
    return a - b;
  });

  const centers = new Map<string, number>();
  let x = 0;

  for (const rank of order) {
    const column = columns.get(rank) ?? [];

    // Inside a column, a box follows the average height of the boxes that
    // depend on it. The columns to the left are already placed.
    const weight = (box: Box): number => {
      const parents = edges
        .filter((edge) => {
          return edge.to === box.node.id && centers.has(edge.from);
        })
        .map((edge) => {
          return centers.get(edge.from) ?? 0;
        });

      if (parents.length === 0) {
        return Number.MAX_SAFE_INTEGER;
      }

      return parents.reduce((total, value) => {
        return total + value;
      }, 0) / parents.length;
    };

    const weighted = column
      .map((box) => {
        return {
          box,
          weight: weight(box),
        };
      })
      .sort((a, b) => {
        if (a.weight === b.weight) {
          return a.box.node.id.localeCompare(b.box.node.id);
        }

        return a.weight - b.weight;
      });

    const total = weighted.reduce((sum, item) => {
      return sum + item.box.height;
    }, 0) + metrics.gapY * Math.max(0, weighted.length - 1);

    let y = -total / 2;
    let width = 0;

    for (const item of weighted) {
      item.box.x = x;
      item.box.y = y;
      centers.set(item.box.node.id, y + item.box.height / 2);
      y += item.box.height + metrics.gapY;
      width = Math.max(width, item.box.width);
    }

    x += width + metrics.gapX;
  }
};

// An edge leaves the row that declares the dependency: the property typed after
// the target, or the method that takes it. A row the card does not draw — a
// private field — is skipped. What is left over leaves the middle of the card.
const anchorOf = (box: Box, edge: ModelEdge): number | undefined => {
  // Scanned in the order of the card, so a property wins over a method and the
  // constructor is the last resort.
  const row = box.rows.find((candidate) => {
    return candidate.kind === "member" && edge.members.includes(candidate.name);
  });

  if (!row) {
    return undefined;
  }

  return box.y + row.end - metrics.rowHeight / 2;
};

const route = (boxes: Box[], edges: ModelEdge[]): RoutedEdge[] => {
  const byId = new Map(
    boxes.map((box) => {
      return [box.node.id, box];
    }),
  );

  const known = edges.filter((edge) => {
    return byId.has(edge.from) && byId.has(edge.to);
  });

  const centerOf = (id: string): number => {
    const box = byId.get(id);

    return box ? box.y + box.height / 2 : 0;
  };

  // Several edges entering one card spread over its height, so two arrows never
  // share a point.
  const incoming = new Map<string, ModelEdge[]>();

  for (const edge of known) {
    const into = incoming.get(edge.to) ?? [];

    into.push(edge);
    incoming.set(edge.to, into);
  }

  const ports = new Map<ModelEdge, number>();

  for (const [id, list] of incoming) {
    const box = byId.get(id);

    if (!box) {
      continue;
    }

    const sorted = [...list].sort((a, b) => {
      return centerOf(a.from) - centerOf(b.from);
    });

    const span = Math.min(box.height - 24, (sorted.length - 1) * 18);
    const start = box.y + box.height / 2 - span / 2;
    const step = sorted.length > 1 ? span / (sorted.length - 1) : 0;

    sorted.forEach((edge, index) => {
      ports.set(edge, sorted.length > 1 ? start + step * index : box.y + box.height / 2);
    });
  }

  return known.map((edge) => {
    const source = byId.get(edge.from) as Box;
    const target = byId.get(edge.to) as Box;
    const back = target.x + target.width / 2 < source.x + source.width / 2;

    return {
      edge,
      from: {
        x: back ? source.x : source.x + source.width,
        y: anchorOf(source, edge) ?? source.y + source.height / 2,
      },
      to: {
        // The head stops short of the border: a card is painted over the edges,
        // and an arrow that ended on the border would be half swallowed.
        x: back ? target.x + target.width + metrics.arrowGap : target.x - metrics.arrowGap,
        y: ports.get(edge) ?? target.y + target.height / 2,
      },
      back,
    };
  });
};

const boundsOf = (boxes: Box[]): Rect => {
  if (boxes.length === 0) {
    return {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

const buildLayout = (model: Model, options: LayoutOptions): Layout => {
  const ctx = ruler();
  const edges = model.edges;

  const boxes = model.nodes.map((node) => {
    return measure(ctx, node);
  });

  place(boxes, edges);

  for (const box of boxes) {
    const moved = options.positions?.get(box.node.id);

    if (moved) {
      box.x = moved.x;
      box.y = moved.y;
    }
  }

  return {
    boxes,
    edges: route(boxes, edges),
    bounds: boundsOf(boxes),
  };
};

// A box has moved: the edges and the extent follow it, the columns do not.
const reroute = (layout: Layout): void => {
  const edges = layout.edges.map((routed) => {
    return routed.edge;
  });

  layout.edges = route(layout.boxes, edges);
  layout.bounds = boundsOf(layout.boxes);
};

export { buildLayout, metrics, reroute };
export type { Box, Layout, LayoutOptions, Point, Rect, RoutedEdge, Row };
