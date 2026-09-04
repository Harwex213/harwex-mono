import { computed } from "@preact/signals-react";
import { nodes } from "./graph-state.js";
import { canvasSize, MIN_SCALE, sizeOf, viewport } from "./viewport.js";

/** Breathing room left around the cards when the canvas is framed. */
const PADDING = 64;

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The box every card fits inside, in canvas coordinates. */
function contentBounds(): Bounds | null {
  const cards = nodes.value;
  if (cards.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of cards) {
    const size = sizeOf(node.id);
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + size.width);
    maxY = Math.max(maxY, node.y + size.height);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Whether any card has pixels on screen. It is checked card by card rather than
 * against the whole box: a canvas can be parked in a gap between two far-apart
 * cards, and the box would call that a view of the content.
 */
const contentInView = computed(() => {
  const view = viewport.value;
  const box = canvasSize.value;
  const cards = nodes.value;
  // Nothing to lose, or nothing measured yet: there is nothing to offer.
  if (cards.length === 0 || box.width === 0) {
    return true;
  }
  return cards.some((node) => {
    const size = sizeOf(node.id);
    const left = node.x * view.scale + view.x;
    const top = node.y * view.scale + view.y;
    return (
      left + size.width * view.scale > 0 &&
      left < box.width &&
      top + size.height * view.scale > 0 &&
      top < box.height
    );
  });
});

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The piece of the canvas the window is showing, in canvas coordinates. */
function viewRect(): Rect {
  const view = viewport.value;
  const box = canvasSize.value;
  return {
    x: -view.x / view.scale,
    y: -view.y / view.scale,
    width: box.width / view.scale,
    height: box.height / view.scale,
  };
}

/** Puts every card back on screen, and never zooms past life size to do it. */
function fitContent(): void {
  const box = canvasSize.value;
  const area = contentBounds();
  if (!area || box.width === 0) {
    return;
  }
  const width = Math.max(area.maxX - area.minX, 1);
  const height = Math.max(area.maxY - area.minY, 1);
  const room = Math.min((box.width - PADDING * 2) / width, (box.height - PADDING * 2) / height);
  const scale = Math.min(1, Math.max(MIN_SCALE, room));
  viewport.value = {
    scale,
    x: (box.width - width * scale) / 2 - area.minX * scale,
    y: (box.height - height * scale) / 2 - area.minY * scale,
  };
}

export type { Bounds, Rect };
export { contentBounds, contentInView, fitContent, viewRect };
