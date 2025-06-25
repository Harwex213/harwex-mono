import { describe, test } from "node:test";
import assert from "node:assert";
import { schema } from "../../services/definition/schema.js";
import { setupTestDatabase, teardownTestDatabase } from "../test-db.js";
import { USER_ROLE_ID } from "../../db/types.js";
import "../../services/alive.js";
import { CRON_JOB_IDS } from "../../services/definition/service-ids.js"; // Import to register the service

describe("Alive Service", () => {
  describe("cron job", () => {
    const aliveServiceCron = schema.cronServices.find(({ id }) => id === CRON_JOB_IDS.ALIVE_NOTIFY_ON_START);
    assert.ok(aliveServiceCron, "Alive service - cron job - should be registered");

    test("should notify ONLY necessary users", async () => {
      const db = await setupTestDatabase();

      const ctx = {
        jsonStringify: JSON.stringify,
        db,
      };

      await db.run(
        "INSERT INTO users (id, chat_id, role_id, notify_on_start) VALUES (?, ?, ?, ?)",
        [1, 1, USER_ROLE_ID.ANON, true],
      );
      await db.run(
        "INSERT INTO users (id, chat_id, role_id, notify_on_start) VALUES (?, ?, ?, ?)",
        [2, 2, USER_ROLE_ID.ANON, false],
      );

      const result = await aliveServiceCron.service(ctx);

      assert.strictEqual(result[0]?.[0], 1, "user should be listed");
      assert.strictEqual(result.length, 1, "user should be alone");

      await teardownTestDatabase(db);
    });
  });
});