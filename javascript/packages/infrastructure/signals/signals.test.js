import { describe, it } from "node:test";
import assert from "node:assert";
import { computed, effect, signal, Signal } from "./incremental-implementation.js";

const createSpy = (cb) => {
    const actualFunc = (...params) => {
        cb(...params);

        actualFunc.calledAmount++;
    };
    actualFunc.calledAmount = 0;

    return actualFunc;
};

const calledOnce = (spyFunc) => spyFunc.calledAmount === 1;
const calledTwice = (spyFunc) => spyFunc.calledAmount === 2;

describe("signal", () => {
    it("should return value", () => {
        const v = [1, 2];
        const s = signal(v);
        assert.strictEqual(s.value, v);
    });

    it("should inherit from Signal", () => {
        assert.strictEqual(signal(0) instanceof Signal, true);
    });

    it("should notify other listeners of changes after one listener is disposed", () => {
        const s = signal(0);
        const spy1 = createSpy(() => {
            s.value;
        });
        const spy2 = createSpy(() => {
            s.value;
        });
        const spy3 = createSpy(() => {
            s.value;
        });

        effect(spy1);
        const dispose = effect(spy2);
        effect(spy3);

        assert.strictEqual(calledOnce(spy1), true);
        assert.strictEqual(calledOnce(spy2), true);
        assert.strictEqual(calledOnce(spy3), true);

        dispose();

        s.value = 1;

        assert.strictEqual(calledTwice(spy1), true);
        assert.strictEqual(calledOnce(spy2), true);
        assert.strictEqual(calledTwice(spy3), true);
    });

    describe(".peek()", { skip: true }, () => {
        it("should get value", () => {
            const s = signal(1);

            assert.strictEqual(s.peek(), 1);
        });

        it("should get the updated value after a value change", () => {
            const s = signal(1);
            s.value = 2;

            assert.strictEqual(s.peek(), 2);
        });

        it("should not make surrounding effect depend on the signal", () => {
            const s = signal(1);
            const spy = createSpy(() => {
                s.peek();
            });

            effect(spy);
            assert.strictEqual(calledOnce(spy), true);

            s.value = 2;
            assert.strictEqual(calledOnce(spy), true);
        });

        it("should not make surrounding computed depend on the signal", () => {
            const s = signal(1);
            const spy = createSpy(() => {
                s.peek();
            });
            const d = computed(spy);

            d.value;
            assert.strictEqual(calledOnce(spy), true);

            s.value = 2;
            d.value;
            assert.strictEqual(calledOnce(spy), true);
        });
    });
});
