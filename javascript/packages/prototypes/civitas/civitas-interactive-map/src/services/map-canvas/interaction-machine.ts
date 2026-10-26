import type { Point } from "../../domain/index";

// Pure state machine of map input: plain events in, next state and commands out.
// It reads neither the DOM nor the store, so every rule is unit tested in Node.
// States: idle, panning (pending | dragging).

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
  | PanState;

type InteractionEvent =
  | {
      type: "pointerDown";
      pointerId: number;
      button: number;
      ctrlKey: boolean;
      clientX: number;
      clientY: number;
      onHudControl: boolean;
      // The current view offset, or `null` before the map has a view.
      view: Point | null;
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
  | { type: "contextMenu"; clientX: number; clientY: number; onHudControl: boolean }
  | { type: "doubleClick"; clientX: number; clientY: number; onHudControl: boolean }
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
  // A context press starts no gesture.
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

  // The left and the middle button pan.
  if (event.button !== 0 && event.button !== 1) {
    return { state, commands: prevent };
  }

  return startPan(event.pointerId, event.clientX, event.clientY, event.view, prevent);
}

function onPointerMove(
  state: InteractionState,
  event: Extract<InteractionEvent, { type: "pointerMove" }>,
): Transition {
  const hover: InteractionCommand = { type: "hover", pixel: event.pixel };

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
// - A left press is a pan, and a pan with no drag selects the province.
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

// Right click selects the country of the province.
// `contextmenu` covers the macOS ctrl+click too.
// The idle guard ignores a right press made during a pan.
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
    // A cancelled pointer never selects.
    case "pointerCancel": {
      return endGesture(event.pointerId);
    }
    // A fallback: pointer capture normally prevents a leave mid-pan.
    case "pointerLeave": {
      return endGesture(event.pointerId, [{ type: "hover", pixel: null }]);
    }
    case "lostPointerCapture": {
      return { state: IDLE, commands: [{ type: "setPanning", on: false }] };
    }
    case "contextMenu": {
      return onContextMenu(state, event);
    }
    case "doubleClick": {
      // No zoom on a HUD control.
      if (event.onHudControl) {
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
