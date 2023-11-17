import test from "node:test";
import assert from "node:assert";
import { LinkedList } from "./linked-list.js";

test("should add array elements to list", () => {
    const list = new LinkedList();

    list.add([1, 2, 3]);
    list.add([1, 2, 3, 1, 2, 3]);

    assert.strictEqual(list.count, 2);
});

test("should create array of elements from list", () => {
    const list = new LinkedList();

    const expectedArrays = [
        [1, 2, 3, 1, 2, 3],
        [1, 2, 3],
    ];
    list.add(expectedArrays[0]);
    list.add(expectedArrays[1]);

    const actualArrays = new Array(2);
    list.toArray(actualArrays);

    assert.deepStrictEqual(actualArrays, expectedArrays);
});

test("should remove first element from list", () => {
    const list = new LinkedList();

    const expectedArray = [1, 2, 3];
    list.add([1, 2, 3, 1, 2, 3]);
    list.add(expectedArray);

    list.removeAt(0);

    assert.deepStrictEqual(list.at(0), expectedArray);
    assert.strictEqual(list.count, 1);
});

test("should remove last element from list", () => {
    const list = new LinkedList();

    const expectedArray = [1, 2, 3];

    list.add([1, 2, 3, 1, 2, 3]);
    list.add(expectedArray);
    list.add([1, 2, 3, 4]);

    list.removeAt(list.count - 1);

    assert.deepStrictEqual(list.at(1), expectedArray);
    assert.strictEqual(list.count, 2);
});

test("should remove first element from list", () => {
    const list = new LinkedList();

    const expectedArray = [1, 2, 3];
    list.add([1, 2, 3, 1, 2, 3]);
    list.add([1, 2, 3, 4, 5, 6]);
    list.add(expectedArray);
    list.add([1, 2, 3, 8, 9, 2]);
    list.add([1, 2, 3, 10, 1, 22]);

    list.removeAt(1);

    assert.deepStrictEqual(list.at(1), expectedArray);
    assert.strictEqual(list.count, 4);
});
