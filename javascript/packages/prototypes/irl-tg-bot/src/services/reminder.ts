import { format, isValid as isDateValid, parse } from "date-fns";
import { schema } from "../schema.js";
import type { TReminder, TReminderWithChatId } from "../db/types.js";
import { EReminderError } from "../errors.js";
import { logger } from "../logger.js";

schema.declare(
  "addreminder",
  "Add a new reminder",
  async (input, ctx) => {
    if (!input) {
      throw new Error(EReminderError.ADD_REMINDER_EMPTY_INPUT);
    }

    const { userId, db } = ctx;
    const dateMatch = input.match(/(\d{2}\.\d{2}\.\d{4})/);

    let targetDate: Date | null = null;
    let content = input;

    const dateStr = dateMatch?.[1] || "";
    const parsedDate = parse(dateStr, "dd.MM.yyyy", new Date());
    if (isDateValid(parsedDate)) {
      targetDate = parsedDate;
      content = input.replace(dateStr, "").trim();
    }

    await db.run(
      "INSERT INTO reminders (user_id, content, target_date) VALUES (?, ?, ?)",
      [userId, content, targetDate],
    );

    const response = targetDate
      ? `Reminder set for ${format(targetDate, "dd.MM.yyyy")}: ${content}`
      : `Daily reminder set: ${content}`;

    return response;
  },
);

schema.declare(
  "dailies",
  "View all your daily reminders",
  async (_, ctx) => {
    const { userId, db } = ctx;

    const reminders = await db.all<TReminder[]>(
      "SELECT * FROM reminders WHERE user_id = ? AND target_date IS NULL",
      [userId],
    );

    if (reminders.length === 0) {
      return "You have no daily reminders set.";
    }

    const reminderList = reminders.map((r) => `ID: ${r.id} - ${r.content}`).join("\n");

    return `Your daily reminders:\n${reminderList}`;
  },
);

schema.declare(
  "monthly",
  "View all your reminders for the current month",
  async (_, ctx) => {
    const { userId, db } = ctx;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

    logger.info(`Fetching monthly reminders for user ${userId} with params [${startOfMonth}, ${endOfMonth}]`);

    const reminders = await db.all<TReminder[]>(
      "SELECT * FROM reminders WHERE user_id = ? AND target_date BETWEEN ? AND ?",
      [userId, startOfMonth, endOfMonth],
    );

    if (reminders.length === 0) {
      return "You have no reminders for this month.";
    }

    const reminderList = reminders.map((r) =>
      `ID: ${r.id} - ${format(new Date(r.target_date), "dd.MM.yyyy")}: ${r.content}`,
    ).join("\n");

    return `Your reminders for ${format(now, "MMMM yyyy")}:\n${reminderList}`;
  },
);

schema.declare(
  "deletereminder",
  "Delete a reminder by its ID",
  async (input, ctx) => {
    const { userId, db } = ctx;

    const reminderId = input;

    const result = await db.run(
      "DELETE FROM reminders WHERE id = ? AND user_id = ?",
      [reminderId, userId],
    );

    if (result.changes === 0) {
      return "Reminder not found or you don't have permission to delete it.";
    }

    return "Reminder deleted successfully.";
  },
);

const notificationTimes: [string, string][] = [["00", "09"], ["00", "15"], ["00", "18"], ["00", "21"]];

schema.cron(
  notificationTimes.map(([minute, hour]) => `0 ${minute} ${hour} * * *`),
  false,
  async ({ db }) => {
    const reminders = await db.all<TReminderWithChatId[]>(`
        SELECT reminders.id         as id,
               user_id,
               chat_id,
               content,
               target_date,
               reminders.created_at as created_at,
               reminders.updated_at as created_at
        FROM reminders
                 JOIN users u on reminders.user_id = u.id
    `);

    const reminderGroups: Record<string, TReminder[]> = {}; // chatId, TReminder[]

    for (const reminder of reminders) {
      const chatId = reminder.chat_id;

      let reminders = reminderGroups[chatId];
      if (!reminders) {
        reminders = [];
        reminderGroups[chatId] = reminders;
      }

      reminders.push(reminder);
    }

    return Object.entries(reminderGroups).map(([chatId, reminders]) => {
      const message = `Your daily reminders:\n${reminders.map((r) => r.content).join("\n")}`;
      return [chatId, message];
    });
  },
);
