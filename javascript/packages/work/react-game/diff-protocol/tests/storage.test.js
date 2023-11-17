import { test } from "node:test";
import assert from "node:assert";
import { Storage } from "../src/storage.js";

const findEntity = (entities, id) => {
    const entity = entities.find((it) => it.id === id);
    assert.ok(entity);
    return entity;
}

test("storage tests", { concurrency: true }, async (t) => {
    const EVENT_ENTITY = "event";

    t.beforeEach((t) => {
        const storage = new Storage();
        storage.defineEntity(EVENT_ENTITY);
        t.storage = storage;
    })

    await t.test("should create entity", (t) => {
        const { storage } = t;

        storage.createEntity(EVENT_ENTITY, {
            id: 1,
            name: "Oleg"
        });
        const events = storage.entities(EVENT_ENTITY);
        assert.deepStrictEqual(findEntity(events, 1), {
            id: 1,
            name: "Oleg"
        });
    });

    await t.test("should update entity", { todo: true }, (t) => {
        const { storage } = t;

        storage.defineEntity("event");
        const events = storage.entities("event");

    });

    await t.test("should delete entity", { todo: true }, (t) => {
        const { storage } = t;

        storage.defineEntity("event");
        const events = storage.entities("event");

    });
})