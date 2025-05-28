import { format, isValid as isDateValid, parse } from "date-fns";
import { EReminderError } from "../errors";
import { schema } from "../schema";

type TReminder = {
  id: number;
  user_id: string;
  content: string;
  target_date: string;
  created_at: string;
  updated_at: string;
}

schema.declare(
  "addreminder",
  "Add a new reminder",
  async (input, ctx) => {
    const { userId, chatId, db, sendMessage } = ctx;
    const dateMatch = input.match(/(\d{2}\.\d{2}\.\d{4})/);
    if (!dateMatch) {
      throw new Error(EReminderError.ADD_REMINDER_INVALID_DATE_MATCH);
    }

    let targetDate: Date | null = null;
    let content = input;

    const dateStr = dateMatch[1];
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

    await sendMessage(chatId, response);
  },
);

schema.declare(
  "dailies",
  "View all your daily reminders",
  async (_, ctx) => {
    const { userId, chatId, db, sendMessage } = ctx;

    const reminders = await db.all<TReminder[]>(
      "SELECT * FROM reminders WHERE user_id = ? AND target_date IS NULL",
      [userId],
    );

    if (reminders.length === 0) {
      await sendMessage(chatId, "You have no daily reminders set.");

      return;
    }

    const reminderList = reminders.map((r) => `ID: ${r.id} - ${r.content}`).join("\n");

    await sendMessage(chatId, `Your daily reminders:\n${reminderList}`);
  },
);

schema.declare(
  "monthly",
  "View all your reminders for the current month",
  async (_, ctx) => {
    const { userId, chatId, db, sendMessage } = ctx;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const reminders = await db.all<TReminder[]>(
      "SELECT * FROM reminders WHERE user_id = ? AND target_date BETWEEN ? AND ?",
      [userId, startOfMonth.toISOString(), endOfMonth.toISOString()],
    );

    if (reminders.length === 0) {
      await sendMessage(chatId, "You have no reminders for this month.");

      return;
    }

    const reminderList = reminders.map((r) =>
      `ID: ${r.id} - ${format(new Date(r.target_date), "dd.MM.yyyy")}: ${r.content}`,
    ).join("\n");

    await sendMessage(chatId, `Your reminders for ${format(now, "MMMM yyyy")}:\n${reminderList}`);
  },
);

schema.declare(
  "deletereminder",
  "Delete a reminder by its ID",
  async (input, ctx) => {
    const { userId, chatId, db, sendMessage } = ctx;

    const reminderId = input;

    const result = await db.run(
      "DELETE FROM reminders WHERE id = ? AND user_id = ?",
      [reminderId, userId],
    );

    if (result.changes === 0) {
      await sendMessage(chatId, "Reminder not found or you don't have permission to delete it.");

      return;
    }

    await sendMessage(chatId, "Reminder deleted successfully.");
  },
);
