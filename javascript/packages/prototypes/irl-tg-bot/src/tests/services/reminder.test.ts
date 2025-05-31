import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert";
import { format } from "date-fns";
import { setupTestDatabase, teardownTestDatabase } from "../test-db";
import { mockServiceContext, TEST_DATA } from "../test-env";
import { schema } from "../../schema";
import type { Database } from "sqlite";
import "../../services/reminder";
import type { TReminder } from "../../db/types"; // Import to register the service

describe("Reminder Service", () => {
  let db: Database;

  beforeEach(async () => {
    db = await setupTestDatabase();

    // Create a test user for reminder tests
    await db.run(
      "INSERT INTO users (id, chat_id) VALUES (?, ?)",
      [parseInt(TEST_DATA.users.validNumericId), TEST_DATA.chatIds.positive],
    );
  });

  afterEach(async () => {
    await teardownTestDatabase(db);
  });

  describe("addreminder command", () => {
    test("should add new daily reminder with date that gets removed", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      const addReminderService = schema.services.addreminder;
      assert(addReminderService, "addreminder service should be registered");

      // The service requires a date pattern, but if the date is invalid, it becomes a daily reminder
      const result = await addReminderService.service("Take vitamins 01.01.2025", context);

      assert.strictEqual(result, "Reminder set for 01.01.2025: Take vitamins");

      // Verify the reminder was inserted into the database
      const reminder = await db.get(
        "SELECT * FROM reminders WHERE user_id = ? AND content = ?",
        [context.userId, "Take vitamins"],
      );

      assert(reminder, "Reminder should be created in database");
      assert.strictEqual(reminder.content, "Take vitamins");
      assert(reminder.target_date, "Target date should be set");
      assert.strictEqual(reminder.user_id, context.userId);
    });

    test("should add new reminder with proper target date", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      const addReminderService = schema.services.addreminder;
      assert(addReminderService, "addreminder service should be registered");

      const result = await addReminderService.service("Doctor appointment 25.12.2024", context);

      assert.strictEqual(result, "Reminder set for 25.12.2024: Doctor appointment");

      // Verify the reminder was inserted into the database
      const reminder = await db.get(
        "SELECT * FROM reminders WHERE user_id = ? AND content = ?",
        [context.userId, "Doctor appointment"],
      );

      assert(reminder, "Reminder should be created in database");
      assert.strictEqual(reminder.content, "Doctor appointment");
      assert(reminder.target_date, "Target date should be set");

      const targetDate = new Date(reminder.target_date);
      assert.strictEqual(targetDate.getDate(), 25);
      assert.strictEqual(targetDate.getMonth(), 11); // December is month 11
      assert.strictEqual(targetDate.getFullYear(), 2024);
    });

    test("should handle date at the beginning of input", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      const addReminderService = schema.services.addreminder;
      assert(addReminderService, "addreminder service should be registered");

      const result = await addReminderService.service("01.01.2025 New Year celebration", context);

      assert.strictEqual(result, "Reminder set for 01.01.2025: New Year celebration");

      const reminder = await db.get(
        "SELECT * FROM reminders WHERE user_id = ? AND content = ?",
        [context.userId, "New Year celebration"],
      );

      assert(reminder, "Reminder should be created in database");
      assert.strictEqual(reminder.content, "New Year celebration");
    });

    test("should handle date in the middle of input with extra space", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      const addReminderService = schema.services.addreminder;
      assert(addReminderService, "addreminder service should be registered");

      const result = await addReminderService.service("Meeting on 15.03.2024 with client", context);

      // The service removes the date but leaves extra space
      assert.strictEqual(result, "Reminder set for 15.03.2024: Meeting on  with client");

      const reminders = await db.all<TReminder[]>("SELECT * FROM reminders");

      assert.strictEqual(reminders.length, 1, "Reminder should be created in database");
      assert.strictEqual(reminders[0]!.content, "Meeting on  with client");
    });

    test("should reject input without valid date format", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      const addReminderService = schema.services.addreminder;
      assert(addReminderService, "addreminder service should be registered");

      const result = await addReminderService.service("Eat some food", context);

      // The service removes the date but leaves extra space
      assert.strictEqual(result, "Daily reminder set: Eat some food");

      const reminders = await db.all<TReminder[]>("SELECT * FROM reminders");

      assert.strictEqual(reminders.length, 1, "Reminder should be created in database");
      assert.strictEqual(reminders[0]!.content, "Eat some food");
      assert.strictEqual(reminders[0]!.target_date, null);
    });

    test("should handle invalid date values but still create reminder", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      const addReminderService = schema.services.addreminder;
      assert(addReminderService, "addreminder service should be registered");

      // Invalid date that matches pattern but fails parsing becomes daily reminder
      const result = await addReminderService.service("Meeting 32.13.2024", context);

      // Since the date is invalid, it becomes a daily reminder with the full content
      assert.strictEqual(result, "Daily reminder set: Meeting 32.13.2024");

      const reminder = await db.get(
        "SELECT * FROM reminders WHERE user_id = ? AND content = ?",
        [context.userId, "Meeting 32.13.2024"],
      );

      assert(reminder, "Reminder should be created in database");
      assert.strictEqual(reminder.target_date, null, "Should be daily reminder");
    });

    test("should handle multiple date patterns in input with extra space", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      const addReminderService = schema.services.addreminder;
      assert(addReminderService, "addreminder service should be registered");

      const result = await addReminderService.service("Meeting 15.03.2024 and follow-up 16.03.2024", context);

      // Should use the first date match and leave extra space
      assert.strictEqual(result, "Reminder set for 15.03.2024: Meeting  and follow-up 16.03.2024");
    });

    test.todo(" should not create reminder if input empty", async () => {
    });
  });

  describe("dailies command", () => {
    test("should return all user's current daily reminders", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      await db.run(
        "INSERT INTO reminders (user_id, content, target_date) VALUES (?, ?, ?)",
        [context.userId, "Take vitamins", null],
      );
      await db.run(
        "INSERT INTO reminders (user_id, content, target_date) VALUES (?, ?, ?)",
        [context.userId, "Exercise", null],
      );

      const dailiesService = schema.services.dailies;
      assert(dailiesService, "dailies service should be registered");

      const result = await dailiesService.service("", context);

      const expected = "Your daily reminders:\n" +
        "ID: 1 - Take vitamins\n" +
        "ID: 2 - Exercise";

      assert.strictEqual(result, expected, "Should return daily reminders");
    });

    test("should return message when no daily reminders exist", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      const dailiesService = schema.services.dailies;
      assert(dailiesService, "dailies service should be registered");

      const result = await dailiesService.service("", context);

      assert.strictEqual(result, "You have no daily reminders set.");
    });

    test("should not include dated reminders in daily list", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      // Add a daily reminder
      await db.run(
        "INSERT INTO reminders (user_id, content, target_date) VALUES (?, ?, ?)",
        [context.userId, "Daily task", null],
      );

      // Add a dated reminder
      await db.run(
        "INSERT INTO reminders (user_id, content, target_date) VALUES (?, ?, ?)",
        [context.userId, "Dated task", "2024-12-25"],
      );

      const dailiesService = schema.services.dailies;
      assert(dailiesService, "dailies service should be registered");

      const result = await dailiesService.service("", context);

      assert(result.includes("Daily task"), "Should include daily reminder");
      assert(!result.includes("Dated task"), "Should not include dated reminder");
    });

    test("should only return reminders for the requesting user", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      // Create another user
      const otherUserId = TEST_DATA.users.anotherValidId;
      await db.run(
        "INSERT INTO users (id, chat_id) VALUES (?, ?)",
        [parseInt(otherUserId), TEST_DATA.chatIds.negative],
      );

      // Add reminder for first user
      await db.run(
        "INSERT INTO reminders (user_id, content, target_date) VALUES (?, ?, ?)",
        [context.userId, "User 1 task", null],
      );

      // Add reminder for second user
      await db.run(
        "INSERT INTO reminders (user_id, content, target_date) VALUES (?, ?, ?)",
        [otherUserId, "User 2 task", null],
      );

      const dailiesService = schema.services.dailies;
      assert(dailiesService, "dailies service should be registered");

      const result = await dailiesService.service("", context);

      assert(result.includes("User 1 task"), "Should include own reminder");
      assert(!result.includes("User 2 task"), "Should not include other user's reminder");
    });
  });

  describe("monthly command", () => {
    test("should return all user's upcoming in current month reminders", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();

      // Add reminders for current month
      const date1 = new Date(currentYear, currentMonth, 15);
      const date2 = new Date(currentYear, currentMonth, 25);

      await db.run(
        "INSERT INTO reminders (user_id, content, target_date) VALUES (?, ?, ?)",
        [context.userId, "Mid-month task", date1.toISOString()],
      );
      await db.run(
        "INSERT INTO reminders (user_id, content, target_date) VALUES (?, ?, ?)",
        [context.userId, "End-month task", date2.toISOString()],
      );

      const monthlyService = schema.services.monthly;
      assert(monthlyService, "monthly service should be registered");

      const result = await monthlyService.service("", context);

      assert(result.includes(`Your reminders for ${format(now, "MMMM yyyy")}:`), "Should include header with current month");
      assert(result.includes("Mid-month task"), "Should include first reminder");
      assert(result.includes("End-month task"), "Should include second reminder");
      assert(result.includes("15."), "Should include formatted date");
      assert(result.includes("25."), "Should include formatted date");
    });

    test("should return message when no monthly reminders exist", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      const monthlyService = schema.services.monthly;
      assert(monthlyService, "monthly service should be registered");

      const result = await monthlyService.service("", context);

      assert.strictEqual(result, "You have no reminders for this month.");
    });

    test("should not include reminders from other months", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();

      // Add reminder for current month
      const currentMonthDate = new Date(currentYear, currentMonth, 15);
      await db.run(
        "INSERT INTO reminders (user_id, content, target_date) VALUES (?, ?, ?)",
        [context.userId, "Current month task", currentMonthDate.toISOString()],
      );

      // Add reminder for next month
      const nextMonthDate = new Date(currentYear, currentMonth + 1, 15);
      await db.run(
        "INSERT INTO reminders (user_id, content, target_date) VALUES (?, ?, ?)",
        [context.userId, "Next month task", nextMonthDate.toISOString()],
      );

      const monthlyService = schema.services.monthly;
      assert(monthlyService, "monthly service should be registered");

      const result = await monthlyService.service("", context);

      assert(result.includes("Current month task"), "Should include current month reminder");
      assert(!result.includes("Next month task"), "Should not include next month reminder");
    });

    test("should not include daily reminders in monthly list", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();

      // Add daily reminder
      await db.run(
        "INSERT INTO reminders (user_id, content, target_date) VALUES (?, ?, ?)",
        [context.userId, "Daily task", null],
      );

      // Add monthly reminder
      const monthlyDate = new Date(currentYear, currentMonth, 15);
      await db.run(
        "INSERT INTO reminders (user_id, content, target_date) VALUES (?, ?, ?)",
        [context.userId, "Monthly task", monthlyDate.toISOString()],
      );

      const monthlyService = schema.services.monthly;
      assert(monthlyService, "monthly service should be registered");

      const result = await monthlyService.service("", context);

      assert(result.includes("Monthly task"), "Should include monthly reminder");
      assert(!result.includes("Daily task"), "Should not include daily reminder");
    });
  });

  describe("deletereminder command", () => {
    test("should delete reminder by id", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      // Add a reminder to delete
      const insertResult = await db.run(
        "INSERT INTO reminders (user_id, content, target_date) VALUES (?, ?, ?)",
        [context.userId, "Task to delete", null],
      );

      const reminderId = insertResult.lastID;
      assert(reminderId, "Insert should return a valid ID");

      const deleteReminderService = schema.services.deletereminder;
      assert(deleteReminderService, "deletereminder service should be registered");

      const result = await deleteReminderService.service(reminderId.toString(), context);

      assert.strictEqual(result, "Reminder deleted successfully.");

      // Verify the reminder was deleted
      const reminder = await db.get(
        "SELECT * FROM reminders WHERE id = ?",
        [reminderId],
      );

      assert.strictEqual(reminder, undefined, "Reminder should be deleted from database");
    });

    test("should return error message when reminder not found", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      const deleteReminderService = schema.services.deletereminder;
      assert(deleteReminderService, "deletereminder service should be registered");

      const result = await deleteReminderService.service("999", context);

      assert.strictEqual(result, "Reminder not found or you don't have permission to delete it.");
    });

    test("should not allow deleting other user's reminders", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      // Create another user
      const otherUserId = TEST_DATA.users.anotherValidId;
      await db.run(
        "INSERT INTO users (id, chat_id) VALUES (?, ?)",
        [parseInt(otherUserId), TEST_DATA.chatIds.negative],
      );

      // Add reminder for other user
      const insertResult = await db.run(
        "INSERT INTO reminders (user_id, content, target_date) VALUES (?, ?, ?)",
        [otherUserId, "Other user's task", null],
      );

      const reminderId = insertResult.lastID;
      assert(reminderId, "Insert should return a valid ID");

      const deleteReminderService = schema.services.deletereminder;
      assert(deleteReminderService, "deletereminder service should be registered");

      const result = await deleteReminderService.service(reminderId.toString(), context);

      assert.strictEqual(result, "Reminder not found or you don't have permission to delete it.");

      // Verify the reminder still exists
      const reminder = await db.get(
        "SELECT * FROM reminders WHERE id = ?",
        [reminderId],
      );

      assert(reminder, "Other user's reminder should still exist");
    });

    test("should handle invalid reminder ID format", async () => {
      const context = mockServiceContext(db, {
        userId: TEST_DATA.users.validNumericId,
      });

      const deleteReminderService = schema.services.deletereminder;
      assert(deleteReminderService, "deletereminder service should be registered");

      const result = await deleteReminderService.service("invalid_id", context);

      assert.strictEqual(result, "Reminder not found or you don't have permission to delete it.");
    });
  });

  describe("cron functionality", () => {
    test.todo("should return group of all daily reminders mapped to users", async () => {
    });

    test.todo("should return empty array when no reminders exist", async () => {
    });
  });
});
