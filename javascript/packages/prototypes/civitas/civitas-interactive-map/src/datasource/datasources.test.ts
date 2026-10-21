import assert from "node:assert/strict";
import test from "node:test";
import { createDatasources } from "./datasources";
import { createMemoryStorage } from "./storage/state-storage";
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

test("the border-push window is 120 ms, far shorter than the persistence one", () => {
  // The border must stay live under a paint drag; a localStorage write need not.
  const borderDelays: number[] = [];
  const saveDelays: number[] = [];
  const borderSources = createDatasources({
    storage: createMemoryStorage(),
    timers: recordingTimers(borderDelays),
  });
  const saveSources = createDatasources({
    storage: createMemoryStorage(),
    timers: recordingTimers(saveDelays),
  });

  borderSources.borderQueue.schedule(() => {});
  saveSources.saveQueue.schedule(() => {});

  assert.deepEqual(borderDelays, [120]);
  assert.equal(saveDelays.length, 1);
  assert.ok(borderDelays[0] < saveDelays[0], "a border push that waited out a save would look stuck");
});
