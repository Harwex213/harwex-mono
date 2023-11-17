import test from "node:test";
import assert from "node:assert";
import { Observable, of, map } from "../src/index.js";

test("should can subscribe to interval observable and unsubscribe after 10 value", (_, done) => {
    let lastValue = 0;

    const observable = new Observable((observer) => {
        let i = 0;
        const intervalId = setInterval(() => observer.next(i++), 0);
        return () => {
            clearInterval(intervalId);
            assert.strictEqual(lastValue, 10);
            done();
        }
    });

    const subscription = observable.subscribe({
        next: (value) => {
            lastValue = value;
            if (value === 10) {
                subscription.unsubscribe();
            }
        },
    });
})

test("should can pipe with two maps", (_, done) => {
    const observable = of(10).pipe(
        map((value) => value * 2),
        map((value) => value * 2),
    );

    observable.subscribe({
        next: (value) => {
            assert.strictEqual(value, 40);
        },
        complete: done
    });
})