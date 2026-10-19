import assert from "node:assert/strict";
import test from "node:test";
import { createDebouncer } from "./debouncer";
import type { TimerHandle, Timers } from "./debouncer";

// Manual timers. `setCalls()` counts arms, so a restarting debounce shows up.
function fakeTimers(): Timers & { run(): void; armed(): number; setCalls(): number } {
  let nextHandle = 1;
  let sets = 0;
  const armed = new Map<number, () => void>();
  return {
    set(fn: () => void, _ms: number): TimerHandle {
      const handle = nextHandle;
      nextHandle += 1;
      sets += 1;
      armed.set(handle, fn);
      return handle as unknown as TimerHandle;
    },
    clear(handle: TimerHandle): void {
      armed.delete(handle as unknown as number);
    },
    run(): void {
      const due = [...armed.values()];
      armed.clear();
      for (const fn of due) {
        fn();
      }
    },
    armed(): number {
      return armed.size;
    },
    setCalls(): number {
      return sets;
    },
  };
}

test("the writer batches a burst into one write and flushes on demand", () => {
  const timers = fakeTimers();
  const debouncer = createDebouncer({ delayMs: 400, timers });
  const ran: number[] = [];

  assert.equal(debouncer.pending(), false);
  for (let at = 0; at < 5; at += 1) {
    debouncer.schedule(() => {
      ran.push(at);
    });
  }
  // Fixed window: one arm for many schedules, so steady typing still gets written.
  assert.equal(timers.armed(), 1);
  assert.equal(timers.setCalls(), 1, "the deadline must not be pushed out by a later schedule");
  assert.equal(debouncer.pending(), true);
  assert.equal(ran.length, 0);

  timers.run();
  assert.deepEqual(ran, [4], "only the newest task runs");
  assert.equal(debouncer.pending(), false);

  debouncer.schedule(() => {
    ran.push(10);
  });
  debouncer.flush();
  assert.deepEqual(ran, [4, 10]);
  assert.equal(timers.armed(), 0);

  // Idempotent: a flush with nothing scheduled runs nothing.
  debouncer.flush();
  assert.deepEqual(ran, [4, 10]);

  debouncer.schedule(() => {
    ran.push(20);
  });
  debouncer.cancel();
  timers.run();
  debouncer.flush();
  assert.deepEqual(ran, [4, 10]);
});
