import test from "node:test";
import assert from "node:assert";
import { PoolAllocator } from "./pool-allocator.js";

const elementsAmount = 10;

const createPool = (elementsAmount) => {
    const constructor = Float32Array;
    return new PoolAllocator(constructor, elementsAmount);
};

test("should create pool allocator", () => {
    const pool = createPool(elementsAmount);

    assert.strictEqual(pool.size, elementsAmount);
});

test("should ", () => {
    const pool = createPool(elementsAmount);

    assert.strictEqual(pool.size, elementsAmount);
});
