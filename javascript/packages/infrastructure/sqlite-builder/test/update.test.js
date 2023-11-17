import test from "node:test";
import assert from "node:assert";

const TABLE_NAME = "test";

test("should create 'update' query", () => {
    const query = update(TABLE_NAME).set({ name: "Jane Doe", age: 32 }).where("id = 1").build();

    const shouldBe = "UPDATE test SET 'name' = 'Jane Doe', 'age' = 32 WHERE id = 1";

    assert.strictEqual(query, shouldBe);
});
