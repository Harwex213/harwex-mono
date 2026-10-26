import assert from "node:assert/strict";
import test from "node:test";
import { createDatasources } from "./datasources";
import type { TimerHandle, Timers } from "./timers/debouncer";

// Timers that record the delay of each armed timer and never fire.
function recordingTimers(delays: number[]): Timers {
  return {
    set(_fn: () => void, ms: number): TimerHandle {
      delays.push(ms);
      return delays.length as unknown as TimerHandle;
    },
    clear(): void {},
  };
}

test("the border-push window is 120 ms", () => {
  const delays: number[] = [];
  const sources = createDatasources({ timers: recordingTimers(delays) });

  sources.borderQueue.schedule(() => {});

  assert.deepEqual(delays, [120]);
});
