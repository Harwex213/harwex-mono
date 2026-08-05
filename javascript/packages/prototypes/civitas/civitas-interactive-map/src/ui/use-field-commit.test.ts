import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { FIELD_COMMIT_MS, useFieldCommit } from "./use-field-commit";
import type { FieldCommit } from "./use-field-commit";

// `useFieldCommit` is a plain hook: no JSX, no signals, no DOM. What it needs is
// a hook dispatcher and a clock, and both are faked here — this file renders no
// component and touches no document.
//
// The dispatcher slot is React's internal `H`. It is reached deliberately and
// asserted for, so a React upgrade fails with a legible message instead of an
// undefined-property crash. React is pinned exactly in `package.json`, so it
// cannot move without someone editing that file.
//
// The clock replaces the GLOBAL `setTimeout` for the duration of a test,
// because the hook calls the global directly and takes no timer injection.

const DISPATCHER_KEY = "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE";

type ReactInternals = { H: unknown };

type StateCell = { kind: "state"; value: unknown };
type RefCell = { kind: "ref"; ref: { current: unknown } };
type EffectCell = { kind: "effect"; deps: readonly unknown[] | undefined; cleanup: (() => void) | null };
type Cell = StateCell | RefCell | EffectCell;

type Host = {
  result: FieldCommit;
  render(value: string, commit: (next: string) => void, delayMs?: number): FieldCommit;
  unmount(): void;
};

type Clock = {
  advance(ms: number): void;
  armed(): number;
  restore(): void;
};

// A fixed-time clock over the global `setTimeout`. Callbacks fire in due order,
// so a test never depends on wall time.
function installClock(): Clock {
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const queue = new Map<number, { due: number; fn: () => void }>();
  let now = 0;
  let nextId = 1;

  function fakeSet(fn: () => void, delay?: number): number {
    const id = nextId;
    nextId += 1;
    queue.set(id, { due: now + (delay ?? 0), fn });
    return id;
  }

  function fakeClear(id?: number): void {
    if (id === undefined) {
      return;
    }
    queue.delete(id);
  }

  globalThis.setTimeout = fakeSet as unknown as typeof globalThis.setTimeout;
  globalThis.clearTimeout = fakeClear as unknown as typeof globalThis.clearTimeout;

  return {
    advance(ms: number): void {
      now += ms;
      const due = [...queue.entries()]
        .filter(([, entry]) => {
          return entry.due <= now;
        })
        .sort((left, right) => {
          return left[1].due - right[1].due;
        });
      for (const [id, entry] of due) {
        queue.delete(id);
        entry.fn();
      }
    },
    armed(): number {
      return queue.size;
    },
    restore(): void {
      globalThis.setTimeout = realSet;
      globalThis.clearTimeout = realClear;
    },
  };
}

// Fails with a legible message instead of an undefined-property crash if a
// React upgrade ever moves the slot.
function reactInternals(): ReactInternals {
  const found = (React as unknown as Record<string, unknown>)[DISPATCHER_KEY];
  if (found === null || typeof found !== "object") {
    throw new Error(
      "React no longer exposes its hook dispatcher under " +
        DISPATCHER_KEY +
        "; this test needs updating",
    );
  }
  return found as ReactInternals;
}

// The smallest dispatcher `useFieldCommit` can run on: `useState`, `useRef` and
// `useEffect`. A state write marks the host dirty; the test re-renders to read
// the new value, which is what React would do on its own.
function mount(value: string, commit: (next: string) => void, delayMs?: number): Host {
  const internals = reactInternals();
  const cells: Cell[] = [];
  let cursor = 0;
  let host: Host | null = null;

  function nextCell<T extends Cell>(make: () => T): T {
    const existing = cells[cursor];
    cursor += 1;
    if (existing !== undefined) {
      return existing as T;
    }
    const made = make();
    cells[cursor - 1] = made;
    return made;
  }

  const dispatcher = {
    useState(initial: unknown): [unknown, (next: unknown) => void] {
      const cell = nextCell<StateCell>(() => {
        return { kind: "state", value: typeof initial === "function" ? initial() : initial };
      });
      function setState(next: unknown): void {
        cell.value = typeof next === "function" ? (next as (prev: unknown) => unknown)(cell.value) : next;
      }
      return [cell.value, setState];
    },
    useRef(initial: unknown): { current: unknown } {
      const cell = nextCell<RefCell>(() => {
        return { kind: "ref", ref: { current: initial } };
      });
      return cell.ref;
    },
    useEffect(create: () => void | (() => void), deps?: readonly unknown[]): void {
      const cell = nextCell<EffectCell>(() => {
        return { kind: "effect", deps: undefined, cleanup: null };
      });
      const first = cell.deps === undefined && cell.cleanup === null;
      const changed =
        deps === undefined ||
        cell.deps === undefined ||
        deps.length !== cell.deps.length ||
        deps.some((entry, at) => {
          return !Object.is(entry, (cell.deps as readonly unknown[])[at]);
        });
      if (!first && !changed) {
        return;
      }
      if (cell.cleanup !== null) {
        cell.cleanup();
        cell.cleanup = null;
      }
      cell.deps = deps ?? [];
      const cleanup = create();
      cell.cleanup = typeof cleanup === "function" ? cleanup : null;
    },
  };

  function render(
    nextValue: string,
    nextCommit: (next: string) => void,
    nextDelay?: number,
  ): FieldCommit {
    const previous = internals.H;
    internals.H = dispatcher;
    cursor = 0;
    try {
      const result = useFieldCommit(nextValue, nextCommit, nextDelay);
      if (host !== null) {
        host.result = result;
      }
      return result;
    } finally {
      internals.H = previous;
    }
  }

  const initial = render(value, commit, delayMs);
  host = {
    result: initial,
    render,
    unmount(): void {
      for (const cell of cells) {
        if (cell.kind === "effect" && cell.cleanup !== null) {
          cell.cleanup();
          cell.cleanup = null;
        }
      }
    },
  };
  return host;
}

test("the field shows the store value until it is typed into", () => {
  const clock = installClock();
  try {
    const seen: string[] = [];
    const host = mount("Testland", (next) => {
      seen.push(next);
    });

    assert.equal(host.result.value, "Testland");
    assert.deepEqual([...seen], [], "a mount commits nothing");

    host.result.onChange("Test");
    assert.equal(host.render("Testland", (next) => seen.push(next)).value, "Test", "the draft wins");
    assert.deepEqual([...seen], [], "and nothing is committed inside the window");
  } finally {
    clock.restore();
  }
});

test("the commit window is FIXED, not restarting", () => {
  // A restarting debounce starves: continuous typing would postpone the write
  // for as long as the user keeps typing. This is the whole reason the hook
  // returns early when a timer is already armed.
  const clock = installClock();
  try {
    const seen: string[] = [];
    const commit = (next: string): void => {
      seen.push(next);
    };
    const host = mount("", commit, 200);

    host.result.onChange("A");
    clock.advance(150);
    host.result.onChange("AB");
    clock.advance(40);
    host.result.onChange("ABC");
    assert.deepEqual([...seen], [], "still inside the one window");

    clock.advance(20);
    assert.deepEqual(seen, ["ABC"], "one commit, at the ORIGINAL deadline, with the latest text");
    assert.equal(clock.armed(), 0, "and the window closed");
  } finally {
    clock.restore();
  }
});

test("a commit clears the draft so the field falls back to the clamped store value", () => {
  // The store clamps at NAME_MAX and the write is synchronous, so the field
  // must show what the store kept, not what was typed. That visible snap is
  // the correct feedback.
  const clock = installClock();
  try {
    let stored = "";
    const commit = (next: string): void => {
      stored = next.slice(0, 4);
    };
    const host = mount("", commit, 200);

    host.result.onChange("ABCDEFGH");
    clock.advance(200);
    assert.equal(stored, "ABCD");
    assert.equal(host.render(stored, commit, 200).value, "ABCD", "the draft is gone, the clamp shows");
  } finally {
    clock.restore();
  }
});

test("blur commits immediately and disarms the window", () => {
  const clock = installClock();
  try {
    const seen: string[] = [];
    const commit = (next: string): void => {
      seen.push(next);
    };
    const host = mount("", commit, 200);

    host.result.onChange("Alnwick");
    assert.equal(clock.armed(), 1);

    host.result.onBlur();
    assert.deepEqual(seen, ["Alnwick"]);
    assert.equal(clock.armed(), 0, "the pending timer was cleared, not left to fire twice");

    clock.advance(500);
    assert.deepEqual(seen, ["Alnwick"], "and it did not fire a second time");
  } finally {
    clock.restore();
  }
});

test("blur with nothing pending commits nothing", () => {
  const clock = installClock();
  try {
    const seen: string[] = [];
    const host = mount("Testland", (next) => {
      seen.push(next);
    });

    host.result.onBlur();
    host.result.onBlur();
    assert.deepEqual([...seen], [], "tabbing through a field must not write to the store");
  } finally {
    clock.restore();
  }
});

test("unmount flushes the last keystroke", () => {
  // Escape closes the panel and a selection change remounts the field. Neither
  // may lose what was typed in the last 200 ms.
  const clock = installClock();
  try {
    const seen: string[] = [];
    const host = mount("", (next) => {
      seen.push(next);
    }, 200);

    host.result.onChange("Alnwic");
    host.result.onChange("Alnwick");
    host.unmount();

    assert.deepEqual(seen, ["Alnwick"]);
    clock.advance(500);
    assert.deepEqual(seen, ["Alnwick"], "and the cancelled timer did not commit it twice");
  } finally {
    clock.restore();
  }
});

test("the unmount flush calls the CURRENT callback, not the first render's", () => {
  // `onCommit` is an arrow function in the parent's JSX, so its identity
  // changes every render. A flush through a stale closure would write into the
  // country that was selected when the field first mounted.
  const clock = installClock();
  try {
    const first: string[] = [];
    const latest: string[] = [];
    const host = mount("", (next) => {
      first.push(next);
    }, 200);

    host.render("", (next) => latest.push(next), 200);
    host.result.onChange("Alnwick");
    host.unmount();

    assert.deepEqual([...first], [], "the first render's callback is dead");
    assert.deepEqual(latest, ["Alnwick"]);
  } finally {
    clock.restore();
  }
});

test("an unmount with nothing pending commits nothing", () => {
  const clock = installClock();
  try {
    const seen: string[] = [];
    const host = mount("Testland", (next) => {
      seen.push(next);
    });

    host.unmount();
    assert.deepEqual([...seen], [], "closing an untouched panel writes nothing");
  } finally {
    clock.restore();
  }
});

test("the default window is FIELD_COMMIT_MS", () => {
  const clock = installClock();
  try {
    const seen: string[] = [];
    const host = mount("", (next) => {
      seen.push(next);
    });

    host.result.onChange("A");
    clock.advance(FIELD_COMMIT_MS - 1);
    assert.deepEqual([...seen], []);
    clock.advance(1);
    assert.deepEqual(seen, ["A"]);

    assert.equal(FIELD_COMMIT_MS, 200, "200 ms turns twenty keystrokes into two store writes");
  } finally {
    clock.restore();
  }
});

test("a later delay argument is picked up by the next window", () => {
  // `delayMs` is held in a ref that is reassigned on every render, so a prop
  // change is not stuck behind the mount.
  const clock = installClock();
  try {
    const seen: string[] = [];
    const commit = (next: string): void => {
      seen.push(next);
    };
    const host = mount("", commit, 200);

    host.render("", commit, 50);
    host.result.onChange("A");
    clock.advance(50);
    assert.deepEqual(seen, ["A"]);
  } finally {
    clock.restore();
  }
});
