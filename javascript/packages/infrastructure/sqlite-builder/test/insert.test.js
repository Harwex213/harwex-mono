import test from "node:test";
import assert from "node:assert";

const TABLE_NAME = "test";

test("should create insert query", () => {
    const query = insert(TABLE_NAME)
        .into(["name", "email", "age"])
        .values(["John Doe", "john@example.com", 30])
        .build();

    const shouldBe = "INSERT INTO test ('name', 'email', 'age') VALUES ('John Doe', 'john@example.com', 30)";

    assert.strictEqual(query, shouldBe);
});
