import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert";
import type { Database } from "sqlite";
import { schema } from "../../services/definition/schema.js";
import { setupTestDatabase, teardownTestDatabase } from "../test-db.js";
import { mockServiceContext, TEST_DATA } from "../test-env.js";
import "../../services/user"; // Import to register the service

function assertUserExists(user: any, expectedUserId: string, expectedChatId: number) {
  if (!user) {
    throw new Error("User should exist in database");
  }

  if (user.id !== parseInt(expectedUserId)) {
    throw new Error(`Expected user ID ${parseInt(expectedUserId)}, got ${user.id}`);
  }

  if (user.chat_id !== expectedChatId) {
    throw new Error(`Expected chat ID ${expectedChatId}, got ${user.chat_id}`);
  }

  if (!user.created_at) {
    throw new Error("User should have created_at timestamp");
  }

  if (!user.updated_at) {
    throw new Error("User should have updated_at timestamp");
  }
}

describe("User Service", () => {
  let db: Database;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase(db);
  });

  describe("start command", () => {
    test("should successfully create a new user", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
        chatId: TEST_DATA.chatIds.positive,
      });

      const startService = schema.services.start;
      assert(startService, "Start service should be registered");

      const result = await startService.service("", context);

      assert.strictEqual(result, "Started new session");

      // Verify the user was inserted into the database
      const user = await db.get(
        "SELECT * FROM users WHERE id = ? AND chat_id = ?",
        [parseInt(context.userId), context.chatId]
      );

      assertUserExists(user, context.userId, context.chatId);
    });

    test("should handle numeric user IDs correctly", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.anotherValidId,
        chatId: TEST_DATA.chatIds.positive,
      });

      const startService = schema.services.start;
      assert(startService, "Start service should be registered");
      const result = await startService.service("", context);

      assert.strictEqual(result, "Started new session");

      const user = await db.get(
        "SELECT * FROM users WHERE id = ? AND chat_id = ?",
        [parseInt(context.userId), context.chatId]
      );

      assertUserExists(user, context.userId, context.chatId);
    });

    test("should handle negative chat IDs", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
        chatId: TEST_DATA.chatIds.negative,
      });

      const startService = schema.services.start;
      assert(startService, "Start service should be registered");
      const result = await startService.service("", context);

      assert.strictEqual(result, "Started new session");

      const user = await db.get(
        "SELECT * FROM users WHERE id = ? AND chat_id = ?",
        [parseInt(context.userId), context.chatId]
      );

      assertUserExists(user, context.userId, context.chatId);
    });

    test("should handle database constraint violations gracefully", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
        chatId: TEST_DATA.chatIds.positive,
      });

      // First insertion should succeed
      const startService = schema.services.start;
      assert(startService, "Start service should be registered");
      await startService.service("", context);

      // Second insertion with same primary key should fail
      await assert.rejects(
        async () => {
          await startService.service("", context);
        },
        (error: any) => {
          return error.message.includes("UNIQUE constraint failed") ||
            error.message.includes("PRIMARY KEY constraint failed");
        },
        "Should throw constraint violation error for duplicate user ID"
      );
    });

    test("should handle non-numeric user ID gracefully", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.invalidNonNumericId,
        chatId: TEST_DATA.chatIds.positive,
      });

      const startService = schema.services.start;
      assert(startService, "Start service should be registered");

      // This should fail because the database expects INTEGER for id
      await assert.rejects(
        async () => {
          await startService.service("", context);
        },
        (error: any) => {
          return error.message.includes("SQLITE_MISMATCH") ||
            error.message.includes("datatype mismatch");
        },
        "Should throw datatype mismatch error for non-numeric user ID"
      );
    });

    test("should handle zero chat ID", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
        chatId: TEST_DATA.chatIds.zero,
      });

      const startService = schema.services.start;
      assert(startService, "Start service should be registered");
      const result = await startService.service("", context);

      assert.strictEqual(result, "Started new session");

      const user = await db.get(
        "SELECT * FROM users WHERE id = ? AND chat_id = ?",
        [parseInt(context.userId), context.chatId]
      );

      assertUserExists(user, context.userId, context.chatId);
    });

    test("should verify service is properly registered in schema", () => {
      const startService = schema.services.start;

      assert(startService, "Start service should be registered");
      assert.strictEqual(startService.description, "Start new session");
      assert.strictEqual(typeof startService.service, "function");
    });

    test("should handle database connection errors", async () => {
      // Create a separate database instance for this test
      const testDb = await setupTestDatabase();
      const context = mockServiceContext(testDb);

      const startService = schema.services.start;
      assert(startService, "Start service should be registered");

      // Close the database to simulate connection error
      await testDb.close();

      await assert.rejects(
        async () => {
          await startService.service("", context);
        },
        (error: any) => {
          return error.message.includes("SQLITE_MISUSE") ||
            error.message.includes("Database is closed") ||
            error.message.includes("database");
        },
        "Should throw database error when connection is closed"
      );
    });
  });

  describe("schema integration", () => {
    test("should have start service registered with correct metadata", () => {
      const services = Object.keys(schema.services);
      assert(services.includes("start"), "Start command should be registered");

      const startService = schema.services.start;
      assert(startService, "Start service should be registered");
      assert.strictEqual(startService.description, "Start new session");
      assert.strictEqual(typeof startService.service, "function");
    });

    test("should accept correct context parameters", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      const startService = schema.services.start;
      assert(startService, "Start service should be registered");

      // Should not throw with correct context
      await assert.doesNotReject(async () => {
        await startService.service("", context);
      });
    });
  });
});
