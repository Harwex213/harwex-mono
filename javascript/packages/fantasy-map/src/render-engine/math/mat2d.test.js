import test from "node:test";
import assert from "node:assert";
import { mat2d_create } from "./mat2d.js";

const getExpected = (a, b, c, d, tx, ty) => `[${a},${b},${c},${d},${tx},${ty}]`;
const getActual = (matrix) => JSON.stringify([...matrix]);

test("mat2d_create: should create matrix without arguments", () => {
    const matrix = mat2d_create();

    const expected = getExpected(1, 0, 0, 1, 0, 0);
    const actual = getActual(matrix);

    assert.strictEqual(actual, expected);
});

test("mat2d_create: should create matrix with arguments", () => {
    const matrix = mat2d_create(2, 0, 0, 2, 20, 20);

    const expected = getExpected(2, 0, 0, 2, 20, 20);
    const actual = getActual(matrix);

    assert.strictEqual(actual, expected);
});
