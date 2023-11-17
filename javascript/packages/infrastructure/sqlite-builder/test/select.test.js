import test from "node:test";
import assert from "node:assert";
import { ORDER_BY_DIRECTION, select, SqliteBuilderError, WHERE_OPERATOR } from "../index.js";

const TABLE_NAME = "test";

test("should create select query (with orderBy, limit, offset)", () => {
    const query = select(TABLE_NAME)
        .props([["prop1", "prop1Renamed"], "prop2", "prop3"])
        .orderBy("prop2", ORDER_BY_DIRECTION.DESC)
        .limit(10)
        .offset(20)
        .build();

    const shouldBe = "SELECT prop1 AS prop1Renamed, prop2, prop3 FROM test ORDER BY prop2 DESC LIMIT 10 OFFSET 20";

    assert.strictEqual(query, shouldBe);
});

test("should create select query with where clause", () => {
    const baseQuery = () => select(TABLE_NAME).props(["prop1"]);

    const queryWithMore = baseQuery().where("prop1", WHERE_OPERATOR.MORE, 10).build();
    const queryWithLess = baseQuery().where("prop1", WHERE_OPERATOR.LESS, 10).build();
    const queryWithEqual = baseQuery().where("prop1", WHERE_OPERATOR.EQUAL, 10).build();
    const queryWithNotEqual = baseQuery().where("prop1", WHERE_OPERATOR.NOT_EQUAL, 10).build();

    const shouldBe = (operator) => `SELECT prop1 FROM test WHERE prop1 ${operator} 10`;

    assert.strictEqual(queryWithMore, shouldBe(WHERE_OPERATOR.MORE));
    assert.strictEqual(queryWithLess, shouldBe(WHERE_OPERATOR.LESS));
    assert.strictEqual(queryWithEqual, shouldBe(WHERE_OPERATOR.EQUAL));
    assert.strictEqual(queryWithNotEqual, shouldBe(WHERE_OPERATOR.NOT_EQUAL));
});

test("should create select query with 'where' 'and' 'or' clauses", () => {
    const query = select(TABLE_NAME)
        .props([["prop1", "prop1Renamed"], "prop2", "prop3"])
        .where("prop1", WHERE_OPERATOR.EQUAL, 10)
        .and("prop2", WHERE_OPERATOR.MORE, 20)
        .or("prop3", WHERE_OPERATOR.LESS, 20)
        .build();

    const shouldBe =
        "SELECT prop1 AS prop1Renamed, prop2, prop3 FROM test WHERE prop1 = 10 AND prop2 > 20 OR prop3 < 20";

    assert.strictEqual(query, shouldBe);
});

test("should create select all without any clauses", () => {
    const query = select(TABLE_NAME).build();

    const shouldBe = "SELECT * FROM test";

    assert.strictEqual(query, shouldBe);
});

test("should create select all if props arguments omitted", () => {
    const query = select(TABLE_NAME).props().build();

    const shouldBe = "SELECT * FROM test";

    assert.strictEqual(query, shouldBe);
});

test("should fail if used >2 where clause", () => {
    assert.throws(() => select(TABLE_NAME).where().where(), SqliteBuilderError);
});

test("should fail if used >2 props clause", () => {
    assert.throws(() => select(TABLE_NAME).props().props(), SqliteBuilderError);
});

test("should fail if used >2 limit clause", () => {
    assert.throws(() => select(TABLE_NAME).limit().limit(), SqliteBuilderError);
});

test("should fail if used >2 offset clause", () => {
    assert.throws(() => select(TABLE_NAME).offset().offset(), SqliteBuilderError);
});

test("should fail if used >2 orderBy clause", () => {
    assert.throws(() => select(TABLE_NAME).orderBy().orderBy(), SqliteBuilderError);
});

test("should not fail using `and` clause after 'where'", () => {
    assert.throws(() => select(TABLE_NAME).and(), SqliteBuilderError);
    assert.throws(() => select(TABLE_NAME).props().and(), SqliteBuilderError);
});

test("should fail on wrong usage of `and` clause", () => {
    assert.throws(() => select(TABLE_NAME).and(), SqliteBuilderError);
    assert.throws(() => select(TABLE_NAME).props().and(), SqliteBuilderError);
});

test("should not fail using `or` clause after 'where'", () => {
    assert.throws(() => select(TABLE_NAME).and(), SqliteBuilderError);
    assert.throws(() => select(TABLE_NAME).props().and(), SqliteBuilderError);
});

test("should fail on wrong usage of `or` clause", () => {
    assert.throws(() => select(TABLE_NAME).or(), SqliteBuilderError);
    assert.throws(() => select(TABLE_NAME).props().or(), SqliteBuilderError);
});
