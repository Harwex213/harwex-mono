import test from "node:test";
import assert from "node:assert";

const TABLE_NAME = "test";

test("should create 'delete' query", () => {
    const query = remove(TABLE_NAME).where("age < 18").build();

    const shouldBe = "DELETE FROM test WHERE age < 18";

    assert.strictEqual(query, shouldBe);
});
