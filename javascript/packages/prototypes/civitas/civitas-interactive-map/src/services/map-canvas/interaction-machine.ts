import type { Point } from "../../domain/index";

// Pure state machine of map input: plain events in, next state and commands out.
// It reads neither the DOM nor the store, so every rule is unit tested in Node.
// States: idle, panning (pending | dragging), strokeRequested, painting.
// `strokeRequested` waits for the `beginStroke` answer: `strokeBegan` or `strokeRefused`.

// Index is `deltaMode`: pixel, line, page.
// Firefox reports one wheel notch as 3 lines. Read as 3 pixels, the wheel barely zooms.
const DELTA_TO_PIXELS = [1, 16, 100];
const WHEEL_STEP = 1.0015;
const DOUBLE_CLICK_FACTOR = 2;
const DRAG_THRESHOLD = 3;

type PanState = {
  kind: "panning";
  phase: "pending" | "dragging";
  pointerId: number;
  // Client pixels. Re-based once when the pan leaves `pending`.
  startX: number;
  startY: number;
  // The view offset at the press.
  originX: number;
  originY: number;
};

type InteractionState =
  | { kind: "idle" }
  | PanState
  | {
      kind: "strokeRequested";
      pointerId: number;
      pixel: Point;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    }
  // `lastX` / `lastY` are MAP pixels: the start point of the next line walk.
  | { kind: "painting"; pointerId: number; lastX: number; lastY: number };

type InteractionEvent =
  | {
      type: "pointerDown";
      pointerId: number;
      button: number;
      ctrlKey: boolean;
      altKey: boolean;
      clientX: number;
      clientY: number;
      onHudControl: boolean;
      // The current view offset, or `null` before the map has a view.
      view: Point | null;
      assignMode: boolean;
      // The map pixel under the press, or `null` outside the map.
      pixel: Point | null;
    }
  | { type: "pointerMove"; pointerId: number; clientX: number; clientY: number; pixel: Point | null }
  | {
      type: "pointerUp";
      pointerId: number;
      button: number;
      ctrlKey: boolean;
      clientX: number;
      clientY: number;
      onHudControl: boolean;
    }
  | { type: "pointerCancel"; pointerId: number }
  | { type: "pointerLeave"; pointerId: number }
  | { type: "lostPointerCapture" }
  | { type: "strokeBegan" }
  | { type: "strokeRefused" }
  | { type: "contextMenu"; clientX: number; clientY: number; onHudControl: boolean }
  | { type: "doubleClick"; clientX: number; clientY: number; onHudControl: boolean; assignMode: boolean }
  | { type: "wheel"; clientX: number; clientY: number; deltaY: number; deltaMode: number }
  | { type: "auxClick" }
  | {
      type: "keyDown";
      key: string;
      altKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
      // The key went to a text field.
      typing: boolean;
    };

// Commands carry client coordinates. The input handler converts them against the host rect.
type InteractionCommand =
  | { type: "preventDefault" }
  | { type: "capturePointer"; pointerId: number }
  | { type: "releasePointer"; pointerId: number }
  | { type: "hover"; pixel: Point | null }
  | { type: "beginStroke"; pixel: Point; erase: boolean }
  | { type: "paintLine"; fromX: number; fromY: number; toX: number; toY: number }
  | { type: "endStroke" }
  | { type: "cancelStroke" }
  | { type: "setPanning"; on: boolean }
  | { type: "panTo"; x: number; y: number }
  | { type: "selectProvinceAt"; clientX: number; clientY: number }
  | { type: "selectCountryAt"; clientX: number; clientY: number }
  | { type: "zoomAt"; clientX: number; clientY: number; factor: number }
  | { type: "toggleLabels" }
  | { type: "resetView" };

type Transition = {
  state: InteractionState;
  commands: InteractionCommand[];
};

const IDLE: InteractionState = { kind: "idle" };

// A context press is button 2 or ctrl+left.
// Decisions:
// - Ctrl+left is the macOS right click. Its button is 0, so only `ctrlKey` marks it.
// - The rule applies on every platform, so no platform sniffing is needed.
// - Windows and Linux fire no `contextmenu` for ctrl+click, so `pointerUp` selects there.
function isContextPress(event: { button: number; ctrlKey: boolean }): boolean {
  return event.button === 2 || (event.button === 0 && event.ctrlKey);
}

function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const delta = deltaY * (DELTA_TO_PIXELS[deltaMode] ?? 1);
  return WHEEL_STEP ** -delta;
}

function stay(state: InteractionState, commands: InteractionCommand[] = []): Transition {
  return { state, commands };
}

// The release names the event's pointer, not the pointer the state held.
function endGesture(pointerId: number, before: InteractionCommand[] = []): Transition {
  return {
    state: IDLE,
    commands: [...before, { type: "releasePointer", pointerId }, { type: "setPanning", on: false }],
  };
}

function startPan(
  pointerId: number,
  clientX: number,
  clientY: number,
  view: Point,
  before: InteractionCommand[],
): Transition {
  return {
    state: {
      kind: "panning",
      phase: "pending",
      pointerId,
      startX: clientX,
      startY: clientY,
      originX: view.x,
      originY: view.y,
    },
    commands: [...before, { type: "capturePointer", pointerId }],
  };
}

// A press from any state replaces the current gesture.
function onPointerDown(
  state: InteractionState,
  event: Extract<InteractionEvent, { type: "pointerDown" }>,
): Transition {
  if (event.onHudControl) {
    return stay(state);
  }
  // A context press starts no gesture, so a ctrl+click never paints.
  // `beginStroke` assigns the province at once and cannot be undone.
  // The return comes before `preventDefault`: a prevented pointerdown suppresses
  // `mousedown`, and some engines derive `contextmenu` from `mousedown`.
  if (isContextPress(event)) {
    return stay(state);
  }
  if (!event.view) {
    return stay(state);
  }
  // Stops text selection, native image drag and Chrome's middle-button autoscroll.
  const prevent: InteractionCommand[] = [{ type: "preventDefault" }];

  // The middle button always pans, so the map stays navigable in assign mode.
  if (event.button === 1) {
    return startPan(event.pointerId, event.clientX, event.clientY, event.view, prevent);
  }
  if (event.button !== 0) {
    return { state, commands: prevent };
  }

  // A press outside the map starts a pan, not a stroke.
  if (event.assignMode && event.pixel) {
    return {
      state: {
        kind: "strokeRequested",
        pointerId: event.pointerId,
        pixel: event.pixel,
        startX: event.clientX,
        startY: event.clientY,
        originX: event.view.x,
        originY: event.view.y,
      },
      // `beginStroke` goes last because its answer is the next event.
      commands: [...prevent, { type: "beginStroke", pixel: event.pixel, erase: event.altKey }],
    };
  }

  return startPan(event.pointerId, event.clientX, event.clientY, event.view, prevent);
}

function onPointerMove(
  state: InteractionState,
  event: Extract<InteractionEvent, { type: "pointerMove" }>,
): Transition {
  const hover: InteractionCommand = { type: "hover", pixel: event.pixel };

  if (state.kind === "painting" && state.pointerId === event.pointerId) {
    // Outside the map the stroke waits, so no line runs to a clamped edge pixel.
    if (!event.pixel) {
      return stay(state, [hover]);
    }
    // A line from the last pixel, because a fast flick skips pixels between moves.
    return {
      state: { ...state, lastX: event.pixel.x, lastY: event.pixel.y },
      commands: [
        hover,
        {
          type: "paintLine",
          fromX: state.lastX,
          fromY: state.lastY,
          toX: event.pixel.x,
          toY: event.pixel.y,
        },
      ],
    };
  }

  if (state.kind !== "panning" || state.pointerId !== event.pointerId) {
    return stay(state, [hover]);
  }

  let dx = event.clientX - state.startX;
  let dy = event.clientY - state.startY;
  if (state.phase === "dragging") {
    // Origin + total delta, not a sum of per-move deltas.
    // A sum drifts and loses the deltas the clamp swallowed.
    return stay(state, [hover, { type: "panTo", x: state.originX + dx, y: state.originY + dy }]);
  }

  const distance = Math.hypot(dx, dy);
  if (distance < DRAG_THRESHOLD) {
    return stay(state, [hover]);
  }
  // Re-base by exactly the threshold along the move direction.
  // The map does not jump, and a fast first move is not lost.
  const startX = state.startX + (dx / distance) * DRAG_THRESHOLD;
  const startY = state.startY + (dy / distance) * DRAG_THRESHOLD;
  dx = event.clientX - startX;
  dy = event.clientY - startY;
  return {
    state: { ...state, phase: "dragging", startX, startY },
    commands: [
      hover,
      { type: "setPanning", on: true },
      { type: "panTo", x: state.originX + dx, y: state.originY + dy },
    ],
  };
}

// Left click ownership:
// - Paint owns the left button when assign mode is on and a country is active.
//   The paint branch returns first, so painting never moves the selection.
// - Otherwise the press is a pan, and a pan with no drag selects the province.
// - Ctrl+left is a context press and selects the country.
// The province comes from the pointer position, so a click with no prior move still selects.
function onPointerUp(
  state: InteractionState,
  event: Extract<InteractionEvent, { type: "pointerUp" }>,
): Transition {
  // Pointer capture retargets to the host. A HUD target means `pointerDown` declined the press.
  if (event.onHudControl) {
    return stay(state);
  }

  if (state.kind === "painting" && state.pointerId === event.pointerId) {
    // `endStroke` flushes the debounced border push, so the outline updates on release.
    return endGesture(event.pointerId, [{ type: "endStroke" }]);
  }

  // Ctrl+click where no `contextmenu` fires.
  // On macOS `contextMenu` already selected, and `sameSelection` swallows the repeat.
  if (event.button === 0 && event.ctrlKey && state.kind === "idle") {
    return stay(state, [{ type: "selectCountryAt", clientX: event.clientX, clientY: event.clientY }]);
  }

  const isClick =
    event.button === 0 &&
    state.kind === "panning" &&
    state.pointerId === event.pointerId &&
    state.phase === "pending";
  const select: InteractionCommand[] = isClick
    ? [{ type: "selectProvinceAt", clientX: event.clientX, clientY: event.clientY }]
    : [];
  return endGesture(event.pointerId, select);
}

// Right click selects the country of the province in both modes.
// `contextmenu` covers the macOS ctrl+click too.
// The idle guard ignores a right press made during a pan or a stroke.
function onContextMenu(
  state: InteractionState,
  event: Extract<InteractionEvent, { type: "contextMenu" }>,
): Transition {
  // Always prevent, so the browser menu never pops, even on a declined press.
  const prevent: InteractionCommand = { type: "preventDefault" };
  if (event.onHudControl || state.kind !== "idle") {
    return stay(state, [prevent]);
  }
  return stay(state, [prevent, { type: "selectCountryAt", clientX: event.clientX, clientY: event.clientY }]);
}

// `L` toggles labels. `0` resets the view.
// `Escape` belongs to `MapPage`, the single owner of that key.
// No `preventDefault`: neither key has a default action outside a text field.
function onKeyDown(event: Extract<InteractionEvent, { type: "keyDown" }>): InteractionCommand[] {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return [];
  }
  if (event.typing) {
    return [];
  }
  if (event.key === "l" || event.key === "L") {
    return [{ type: "toggleLabels" }];
  }
  if (event.key === "0") {
    return [{ type: "resetView" }];
  }
  return [];
}

function transition(state: InteractionState, event: InteractionEvent): Transition {
  switch (event.type) {
    case "pointerDown": {
      return onPointerDown(state, event);
    }
    case "pointerMove": {
      return onPointerMove(state, event);
    }
    case "pointerUp": {
      return onPointerUp(state, event);
    }
    case "strokeBegan": {
      if (state.kind !== "strokeRequested") {
        return stay(state);
      }
      return {
        state: { kind: "painting", pointerId: state.pointerId, lastX: state.pixel.x, lastY: state.pixel.y },
        commands: [{ type: "capturePointer", pointerId: state.pointerId }],
      };
    }
    case "strokeRefused": {
      // No active country: the press becomes a pan, so the map stays usable.
      if (state.kind !== "strokeRequested") {
        return stay(state);
      }
      const origin = { x: state.originX, y: state.originY };
      return startPan(state.pointerId, state.startX, state.startY, origin, []);
    }
    // A cancelled pointer never selects.
    // A cancelled stroke keeps its pixels but skips the border flush.
    case "pointerCancel": {
      return endGesture(event.pointerId, [{ type: "cancelStroke" }]);
    }
    // A fallback: pointer capture normally prevents a leave mid-stroke.
    case "pointerLeave": {
      const before: InteractionCommand[] = [{ type: "hover", pixel: null }];
      if (state.kind === "painting") {
        before.push({ type: "cancelStroke" });
      }
      return endGesture(event.pointerId, before);
    }
    case "lostPointerCapture": {
      const commands: InteractionCommand[] = [];
      if (state.kind === "painting") {
        commands.push({ type: "cancelStroke" });
      }
      commands.push({ type: "setPanning", on: false });
      return { state: IDLE, commands };
    }
    case "contextMenu": {
      return onContextMenu(state, event);
    }
    case "doubleClick": {
      // No zoom on a HUD control.
      // No zoom in assign mode: a double click there is two strokes.
      if (event.onHudControl || event.assignMode) {
        return stay(state);
      }
      return stay(state, [
        { type: "zoomAt", clientX: event.clientX, clientY: event.clientY, factor: DOUBLE_CLICK_FACTOR },
      ]);
    }
    case "wheel": {
      return stay(state, [
        { type: "preventDefault" },
        {
          type: "zoomAt",
          clientX: event.clientX,
          clientY: event.clientY,
          factor: wheelZoomFactor(event.deltaY, event.deltaMode),
        },
      ]);
    }
    // Stops Chrome's middle-click autoscroll widget.
    case "auxClick": {
      return stay(state, [{ type: "preventDefault" }]);
    }
    case "keyDown": {
      return stay(state, onKeyDown(event));
    }
  }
}

export {
  DRAG_THRESHOLD,
  IDLE,
  isContextPress,
  transition,
  wheelZoomFactor,
  type InteractionCommand,
  type InteractionEvent,
  type InteractionState,
};
