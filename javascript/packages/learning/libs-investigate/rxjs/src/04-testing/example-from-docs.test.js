import { TestScheduler } from "rxjs/testing";
import { throttleTime } from "rxjs";
import assert from "node:assert";
import { it } from "node:test";

const testScheduler = new TestScheduler((actual, expected) => {
  console.log(JSON.stringify(actual), JSON.stringify(expected));
  assert.deepEqual(actual, expected);
});

it("generates the stream correctly", () => {
  testScheduler.run((helpers) => {
    const { cold, time, expectObservable, expectSubscriptions } = helpers;
    const e1 = cold("-a--b--c---|");
    const e1subs = "^----------!";
    const t = time("  ------|  "); // t = 3
    const expected = "-a---------|";

    // "-a--b--c---|"
    // "^----------!"
    // "-a---------|"
    // "  ------|  " - throttleTime

    expectObservable(e1.pipe(throttleTime(t))).toBe(expected);
    expectSubscriptions(e1.subscriptions).toBe(e1subs);
  });
});