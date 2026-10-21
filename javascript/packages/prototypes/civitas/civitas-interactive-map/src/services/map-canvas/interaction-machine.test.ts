import assert from "node:assert/strict";
import test from "node:test";
import {
  DRAG_THRESHOLD,
  IDLE,
  isContextPress,
  transition,
  wheelZoomFactor,
  type InteractionCommand,
  type InteractionEvent,
  type InteractionState,
} from "./interaction-machine";

type PointerDown = Extract<InteractionEvent, { type: "pointerDown" }>;
type PointerUp = Extract<InteractionEvent, { type: "pointerUp" }>;

function down(patch: Partial<PointerDown> = {}): PointerDown {
  return {
    type: "pointerDown",
    pointerId: 1,
    button: 0,
    ctrlKey: false,
    altKey: false,
    clientX: 100,
    clientY: 100,
    onHudControl: false,
    view: { x: 10, y: 20 },
    assignMode: false,
    pixel: { x: 500, y: 600 },
    ...patch,
  };
}

function up(patch: Partial<PointerUp> = {}): PointerUp {
  return {
    type: "pointerUp",
    pointerId: 1,
    button: 0,
    ctrlKey: false,
    clientX: 100,
    clientY: 100,
    onHudControl: false,
    ...patch,
  };
}

function move(clientX: number, clientY: number, pixel: { x: number; y: number } | null = null): InteractionEvent {
  return { type: "pointerMove", pointerId: 1, clientX, clientY, pixel };
}

function types(commands: readonly InteractionCommand[]): string[] {
  return commands.map((command) => {
    return command.type;
  });
}

// Runs events in order and feeds no stroke answer; returns the last transition.
function run(events: readonly InteractionEvent[], start: InteractionState = IDLE) {
  let state = start;
  let commands: InteractionCommand[] = [];
  for (const event of events) {
    const next = transition(state, event);
    state = next.state;
    commands = next.commands;
  }
  return { state, commands };
}

const PENDING_PAN: InteractionState = {
  kind: "panning",
  phase: "pending",
  pointerId: 1,
  startX: 100,
  startY: 100,
  originX: 10,
  originY: 20,
};

const PAINTING: InteractionState = { kind: "painting", pointerId: 1, lastX: 500, lastY: 600 };

test("a context press is button 2 or a ctrl+left press", () => {
  assert.equal(isContextPress({ button: 2, ctrlKey: false }), true);
  assert.equal(isContextPress({ button: 0, ctrlKey: true }), true);
  assert.equal(isContextPress({ button: 0, ctrlKey: false }), false);
  assert.equal(isContextPress({ button: 1, ctrlKey: true }), false);
});

test("a left press in pan mode starts a pending pan and captures the pointer", () => {
  const next = transition(IDLE, down());
  assert.deepEqual(next.state, PENDING_PAN);
  assert.deepEqual(next.commands, [{ type: "preventDefault" }, { type: "capturePointer", pointerId: 1 }]);
});

test("a context press starts nothing and does not prevent the default", () => {
  for (const event of [down({ button: 2 }), down({ button: 0, ctrlKey: true })]) {
    const next = transition(IDLE, event);
    assert.equal(next.state, IDLE);
    assert.deepEqual(next.commands, []);
  }
});

test("a press on a HUD control or before the map has a view is ignored", () => {
  assert.deepEqual(transition(IDLE, down({ onHudControl: true })).commands, []);
  assert.deepEqual(transition(IDLE, down({ view: null })).commands, []);
});

test("the middle button pans even in assign mode", () => {
  const next = transition(IDLE, down({ button: 1, assignMode: true }));
  assert.equal(next.state.kind, "panning");
  assert.deepEqual(types(next.commands), ["preventDefault", "capturePointer"]);
});

test("another button only prevents the default", () => {
  const next = transition(IDLE, down({ button: 3 }));
  assert.equal(next.state, IDLE);
  assert.deepEqual(types(next.commands), ["preventDefault"]);
});

test("a left press in assign mode requests a stroke, with alt as erase", () => {
  const next = transition(IDLE, down({ assignMode: true, altKey: true }));
  assert.equal(next.state.kind, "strokeRequested");
  assert.deepEqual(next.commands, [
    { type: "preventDefault" },
    { type: "beginStroke", pixel: { x: 500, y: 600 }, erase: true },
  ]);
});

test("a left press in assign mode outside the map pans", () => {
  const next = transition(IDLE, down({ assignMode: true, pixel: null }));
  assert.equal(next.state.kind, "panning");
});

test("an accepted stroke paints from the pressed pixel and captures the pointer", () => {
  const next = run([down({ assignMode: true }), { type: "strokeBegan" }]);
  assert.deepEqual(next.state, PAINTING);
  assert.deepEqual(next.commands, [{ type: "capturePointer", pointerId: 1 }]);
});

test("a refused stroke falls back to a pending pan from the press", () => {
  const next = run([down({ assignMode: true }), { type: "strokeRefused" }]);
  assert.deepEqual(next.state, PENDING_PAN);
  assert.deepEqual(next.commands, [{ type: "capturePointer", pointerId: 1 }]);
});

test("a stroke answer outside strokeRequested changes nothing", () => {
  assert.deepEqual(transition(IDLE, { type: "strokeBegan" }), { state: IDLE, commands: [] });
  assert.deepEqual(transition(PENDING_PAN, { type: "strokeRefused" }).state, PENDING_PAN);
});

test("every move reports the hover first", () => {
  const next = transition(IDLE, move(5, 5, { x: 1, y: 2 }));
  assert.deepEqual(next.commands, [{ type: "hover", pixel: { x: 1, y: 2 } }]);
});

test("a pan stays pending below the drag threshold", () => {
  const next = transition(PENDING_PAN, move(100 + DRAG_THRESHOLD - 1, 100));
  assert.deepEqual(next.state, PENDING_PAN);
  assert.deepEqual(types(next.commands), ["hover"]);
});

test("crossing the threshold re-bases by exactly the threshold and starts dragging", () => {
  const next = transition(PENDING_PAN, move(110, 100));
  assert.equal(next.state.kind, "panning");
  if (next.state.kind !== "panning") {
    return;
  }
  assert.equal(next.state.phase, "dragging");
  assert.equal(next.state.startX, 100 + DRAG_THRESHOLD);
  assert.equal(next.state.startY, 100);
  assert.deepEqual(next.commands.slice(1), [
    { type: "setPanning", on: true },
    { type: "panTo", x: 10 + 10 - DRAG_THRESHOLD, y: 20 },
  ]);
});

test("a drag pans to origin plus the total delta, not a sum of steps", () => {
  const dragging = transition(PENDING_PAN, move(110, 100)).state;
  const next = transition(dragging, move(150, 140));
  assert.deepEqual(next.state, dragging);
  assert.deepEqual(next.commands[1], {
    type: "panTo",
    x: 10 + 150 - (100 + DRAG_THRESHOLD),
    y: 20 + 140 - 100,
  });
});

test("a move from another pointer does not pan", () => {
  const next = transition(PENDING_PAN, { type: "pointerMove", pointerId: 2, clientX: 300, clientY: 300, pixel: null });
  assert.deepEqual(types(next.commands), ["hover"]);
});

test("painting walks the line from the last pixel and advances it", () => {
  const next = transition(PAINTING, move(0, 0, { x: 520, y: 610 }));
  assert.deepEqual(next.state, { ...PAINTING, lastX: 520, lastY: 610 });
  assert.deepEqual(next.commands[1], { type: "paintLine", fromX: 500, fromY: 600, toX: 520, toY: 610 });
});

test("painting off the map waits instead of painting", () => {
  const next = transition(PAINTING, move(0, 0, null));
  assert.deepEqual(next.state, PAINTING);
  assert.deepEqual(next.commands, [{ type: "hover", pixel: null }]);
});

test("releasing a stroke ends it and the gesture", () => {
  const next = transition(PAINTING, up());
  assert.equal(next.state, IDLE);
  assert.deepEqual(next.commands, [
    { type: "endStroke" },
    { type: "releasePointer", pointerId: 1 },
    { type: "setPanning", on: false },
  ]);
});

test("a click without a drag selects the province", () => {
  const next = transition(PENDING_PAN, up({ clientX: 7, clientY: 8 }));
  assert.equal(next.state, IDLE);
  assert.deepEqual(next.commands, [
    { type: "selectProvinceAt", clientX: 7, clientY: 8 },
    { type: "releasePointer", pointerId: 1 },
    { type: "setPanning", on: false },
  ]);
});

test("a drag does not select on release", () => {
  const dragging = transition(PENDING_PAN, move(150, 100)).state;
  assert.deepEqual(types(transition(dragging, up()).commands), ["releasePointer", "setPanning"]);
});

test("a middle click does not select", () => {
  assert.deepEqual(types(transition(PENDING_PAN, up({ button: 1 })).commands), [
    "releasePointer",
    "setPanning",
  ]);
});

test("a ctrl+left release in idle selects the country and ends nothing", () => {
  const next = transition(IDLE, up({ ctrlKey: true, clientX: 3, clientY: 4 }));
  assert.equal(next.state, IDLE);
  assert.deepEqual(next.commands, [{ type: "selectCountryAt", clientX: 3, clientY: 4 }]);
});

test("a release on a HUD control does nothing", () => {
  assert.deepEqual(transition(PENDING_PAN, up({ onHudControl: true })), { state: PENDING_PAN, commands: [] });
});

test("a cancelled pointer cancels the stroke and never selects", () => {
  const next = transition(PENDING_PAN, { type: "pointerCancel", pointerId: 1 });
  assert.equal(next.state, IDLE);
  assert.deepEqual(types(next.commands), ["cancelStroke", "releasePointer", "setPanning"]);
});

test("leaving the host clears the hover and cancels only a stroke", () => {
  assert.deepEqual(types(transition(PAINTING, { type: "pointerLeave", pointerId: 1 }).commands), [
    "hover",
    "cancelStroke",
    "releasePointer",
    "setPanning",
  ]);
  assert.deepEqual(types(transition(PENDING_PAN, { type: "pointerLeave", pointerId: 1 }).commands), [
    "hover",
    "releasePointer",
    "setPanning",
  ]);
});

test("a lost capture goes idle and cancels only a stroke", () => {
  assert.deepEqual(transition(PAINTING, { type: "lostPointerCapture" }), {
    state: IDLE,
    commands: [{ type: "cancelStroke" }, { type: "setPanning", on: false }],
  });
  assert.deepEqual(types(transition(PENDING_PAN, { type: "lostPointerCapture" }).commands), ["setPanning"]);
});

test("a context menu always prevents the default and selects the country only when idle", () => {
  const event: InteractionEvent = { type: "contextMenu", clientX: 1, clientY: 2, onHudControl: false };
  assert.deepEqual(transition(IDLE, event).commands, [
    { type: "preventDefault" },
    { type: "selectCountryAt", clientX: 1, clientY: 2 },
  ]);
  assert.deepEqual(types(transition(PENDING_PAN, event).commands), ["preventDefault"]);
  assert.deepEqual(types(transition(PAINTING, event).commands), ["preventDefault"]);
  assert.deepEqual(types(transition(IDLE, { ...event, onHudControl: true }).commands), ["preventDefault"]);
});

test("a double click zooms 2x, but not in assign mode or on a HUD control", () => {
  const event: InteractionEvent = {
    type: "doubleClick",
    clientX: 5,
    clientY: 6,
    onHudControl: false,
    assignMode: false,
  };
  assert.deepEqual(transition(IDLE, event).commands, [{ type: "zoomAt", clientX: 5, clientY: 6, factor: 2 }]);
  assert.deepEqual(transition(IDLE, { ...event, assignMode: true }).commands, []);
  assert.deepEqual(transition(IDLE, { ...event, onHudControl: true }).commands, []);
});

test("the wheel converts line and page deltas to pixels", () => {
  assert.equal(wheelZoomFactor(100, 0), 1.0015 ** -100);
  assert.equal(wheelZoomFactor(3, 1), 1.0015 ** -48);
  assert.equal(wheelZoomFactor(1, 2), 1.0015 ** -100);
  assert.equal(wheelZoomFactor(10, 9), 1.0015 ** -10);
  const next = transition(PAINTING, { type: "wheel", clientX: 1, clientY: 2, deltaY: -100, deltaMode: 0 });
  assert.deepEqual(next.state, PAINTING);
  assert.deepEqual(next.commands, [
    { type: "preventDefault" },
    { type: "zoomAt", clientX: 1, clientY: 2, factor: 1.0015 ** 100 },
  ]);
});

test("an aux click only prevents the default", () => {
  assert.deepEqual(transition(IDLE, { type: "auxClick" }).commands, [{ type: "preventDefault" }]);
});

test("L toggles labels and 0 resets the view, except with modifiers or while typing", () => {
  const key = (patch: Partial<Extract<InteractionEvent, { type: "keyDown" }>>): InteractionEvent => {
    return { type: "keyDown", key: "l", altKey: false, ctrlKey: false, metaKey: false, typing: false, ...patch };
  };
  assert.deepEqual(types(transition(IDLE, key({})).commands), ["toggleLabels"]);
  assert.deepEqual(types(transition(IDLE, key({ key: "L" })).commands), ["toggleLabels"]);
  assert.deepEqual(types(transition(IDLE, key({ key: "0" })).commands), ["resetView"]);
  assert.deepEqual(transition(IDLE, key({ key: "x" })).commands, []);
  assert.deepEqual(transition(IDLE, key({ typing: true })).commands, []);
  assert.deepEqual(transition(IDLE, key({ ctrlKey: true })).commands, []);
  assert.deepEqual(transition(IDLE, key({ metaKey: true, key: "0" })).commands, []);
  assert.deepEqual(transition(IDLE, key({ altKey: true })).commands, []);
});

test("a new press replaces the current gesture", () => {
  const next = transition(PAINTING, down({ button: 1, pointerId: 2 }));
  assert.equal(next.state.kind, "panning");
  assert.deepEqual(types(next.commands), ["preventDefault", "capturePointer"]);
});
