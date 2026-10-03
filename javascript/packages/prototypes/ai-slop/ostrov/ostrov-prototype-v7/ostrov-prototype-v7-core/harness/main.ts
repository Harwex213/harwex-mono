import { Camera } from "./camera";
import { boxAt, paintDiagram } from "./diagram";
import { renderInspector } from "./inspector";
import { buildLayout, reroute } from "./layout";
import { model } from "./model";
import { edgeThemes, edgeTitles, nodeThemes, nodeTitles } from "./theme";
import type { Insets } from "./camera";
import type { Box, Layout, Point } from "./layout";
import type { EdgeKind, NodeKind } from "./model";

const pick = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`The harness page has no ${selector}`);
  }

  return element;
};

const stage = pick("#stage");
const search = pick<HTMLInputElement>("#search");
const zoomLabel = pick("#zoom");
const panel = pick("#panel");
const nodeKeys = pick("#node-keys");
const edgeKeys = pick("#edge-keys");
const inspector = pick("#inspector");

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");

if (!ctx) {
  throw new Error("Canvas 2d context is not available");
}

stage.append(canvas);

const camera = new Camera();
const size: Point = {
  x: window.innerWidth,
  y: window.innerHeight,
};

// Where a drag has left a card. The positions outlive a rebuild; only format
// drops them and lets the columns place everything again.
const positions = new Map<string, Point>();

let layout: Layout = buildLayout(model, {
  positions,
});
let active: string | undefined;
let selected: string | undefined;
let frame = 0;

const draw = (): void => {
  frame = 0;

  paintDiagram({
    ctx,
    layout,
    camera,
    size,
    highlight: {
      active,
      selected,
      query: search.value.trim(),
    },
  });

  zoomLabel.textContent = `${Math.round(camera.scale * 100)}%`;
};

// One paint per frame, whatever asked for it.
const redraw = (): void => {
  if (frame) {
    return;
  }

  frame = window.requestAnimationFrame(draw);
};

const resize = (): void => {
  const ratio = window.devicePixelRatio || 1;

  size.x = stage.clientWidth;
  size.y = stage.clientHeight;
  canvas.width = Math.round(size.x * ratio);
  canvas.height = Math.round(size.y * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  redraw();
};

// The panel and the open card sit on top of the canvas.
const insets = (): Insets => {
  return {
    top: 40,
    right: inspector.classList.contains("open") ? inspector.clientWidth + 40 : 40,
    bottom: panel.clientHeight + 32,
    left: 40,
  };
};

const fitAll = (): void => {
  camera.fit(layout.bounds, size, insets());
  redraw();
};

const rebuild = (): void => {
  layout = buildLayout(model, {
    positions,
  });
  fitAll();
};

// Format forgets every drag and lays the columns out again.
const format = (): void => {
  positions.clear();
  rebuild();
};

const boxUnder = (event: PointerEvent | MouseEvent): Box | undefined => {
  const rect = canvas.getBoundingClientRect();

  return boxAt(
    layout,
    camera.toWorld({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }),
  );
};

const select = (id: string | undefined): void => {
  selected = id;

  const node = model.nodes.find((candidate) => {
    return candidate.id === id;
  });

  renderInspector(inspector, node, () => {
    select(undefined);
  });

  redraw();
};

let dragging = false;
let held: Box | undefined;
let last: Point = {
  x: 0,
  y: 0,
};
let moved = 0;

canvas.addEventListener("pointerdown", (event) => {
  dragging = true;
  moved = 0;
  held = boxUnder(event);
  last = {
    x: event.clientX,
    y: event.clientY,
  };
  canvas.classList.add("dragging");
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (dragging) {
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;

    moved += Math.abs(dx) + Math.abs(dy);
    last = {
      x: event.clientX,
      y: event.clientY,
    };

    // A card under the cursor moves on its own, the empty canvas moves the view.
    if (held) {
      held.x += dx / camera.scale;
      held.y += dy / camera.scale;
      positions.set(held.node.id, {
        x: held.x,
        y: held.y,
      });
      reroute(layout);
      redraw();

      return;
    }

    camera.panBy(dx, dy);
    redraw();

    return;
  }

  const box = boxUnder(event);
  const next = box?.node.id;

  if (next !== active) {
    active = next;
    canvas.style.cursor = next ? "pointer" : "grab";
    redraw();
  }
});

const endDrag = (event: PointerEvent): void => {
  if (!dragging) {
    return;
  }

  dragging = false;
  held = undefined;
  canvas.classList.remove("dragging");
  canvas.releasePointerCapture(event.pointerId);

  // A drag moves something; a press without travel selects.
  if (moved < 4) {
    select(boxUnder(event)?.node.id);
  }
};

canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const point: Point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    // A trackpad two-finger swipe pans, a pinch or a wheel zooms.
    if (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      camera.panBy(-event.deltaX, -event.deltaY);
      redraw();

      return;
    }

    camera.zoomAt(point, Math.exp(-event.deltaY * 0.0016));
    redraw();
  },
  {
    passive: false,
  },
);

canvas.addEventListener("dblclick", (event) => {
  const box = boxUnder(event);

  if (box) {
    camera.focus(box, size);
    select(box.node.id);

    return;
  }

  fitAll();
});

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) {
    if (event.key === "Escape") {
      search.value = "";
      search.blur();
      redraw();
    }

    return;
  }

  if (event.key === "f") {
    fitAll();
  }

  if (event.key === "r") {
    format();
  }

  if (event.key === "+" || event.key === "=") {
    camera.zoomBy(1.2, size);
    redraw();
  }

  if (event.key === "-") {
    camera.zoomBy(1 / 1.2, size);
    redraw();
  }

  if (event.key === "Escape") {
    select(undefined);
  }

  if (event.key === "/") {
    event.preventDefault();
    search.focus();
  }
});

pick("#format").addEventListener("click", format);
pick("#fit").addEventListener("click", fitAll);

pick("#in").addEventListener("click", () => {
  camera.zoomBy(1.2, size);
  redraw();
});

pick("#out").addEventListener("click", () => {
  camera.zoomBy(1 / 1.2, size);
  redraw();
});

search.addEventListener("input", redraw);

window.addEventListener("resize", resize);

const legendRow = (mark: HTMLElement, text: string): HTMLElement => {
  const row = document.createElement("div");

  row.className = "row";
  row.append(mark, document.createTextNode(text));

  return row;
};

// A card carries no kind of its own any more: the colour of its header says it,
// and the legend reads the colour out.
const renderLegend = (): void => {
  const kinds: NodeKind[] = ["class", "type"];

  for (const kind of kinds) {
    const chip = document.createElement("span");
    const theme = nodeThemes[kind];

    chip.className = "chip";
    chip.style.background = theme.head;
    chip.style.color = theme.label;
    nodeKeys.append(legendRow(chip, nodeTitles[kind]));
  }

  const links: EdgeKind[] = ["extends", "creates", "uses"];

  for (const kind of links) {
    const dash = document.createElement("span");

    dash.className = "dash";
    dash.style.color = edgeThemes[kind];
    edgeKeys.append(legendRow(dash, edgeTitles[kind]));
  }
};

renderLegend();
resize();
fitAll();
