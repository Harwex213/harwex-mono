import TelegramBot from "node-telegram-bot-api";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { config } from "@dotenvx/dotenvx";
import cron from "node-cron";
import { schema } from "./schema";

async function initializeDatabase() {
  const db = await open({
    filename: "reminders.db",
    driver: sqlite3.Database,
  });

  await db.exec(`
      CREATE TABLE IF NOT EXISTS reminders
      (
          id
              INTEGER
              PRIMARY
                  KEY
              AUTOINCREMENT,
          user_id
              TEXT
              NOT
                  NULL,
          content
              TEXT
              NOT
                  NULL,
          target_date
              DATETIME,
          created_at
              DATETIME
              DEFAULT
                  CURRENT_TIMESTAMP,
          updated_at
              DATETIME
              DEFAULT
                  CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_user_id ON reminders (user_id);
      CREATE INDEX IF NOT EXISTS idx_target_date ON reminders (target_date);
  `);

  return db;
}

async function main() {
  config();

  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  console.log("token", botToken);

  if (!botToken) {
    throw new Error("No bot token provided");
  }

  const db = await initializeDatabase();

  console.log("Database initialized successfully");

  const bot = new TelegramBot(botToken, { polling: true });

  const commands = Object.entries(schema.services).map(([command, service]) => ({
    command,
    description: service.description,
  }));

  await bot.setMyCommands(commands);

  console.log("Bot is running...");

  const sendMessage = async (chatId: number, input: string) => {
    await bot.sendMessage(chatId, input);
  };

  bot.onText(/\/(.+) (.+)/, async (msg, match) => {
    if (!match || !msg.from) {
      return;
    }

    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const command = match[0].trim();
    const input = match[1].trim();

    const service = schema.services[command];
    if (!service) {
      return;
    }

    try {
      await service.service(input, {
        chatId,
        userId,
        db,
        sendMessage,
      });
    } catch (e) {
      await bot.sendMessage(chatId, "Cannot handle command with such parameters. Check your inputs");
    }
  });

  const notificationTimes = ["09:00", "15:00", "21:00"];

  notificationTimes.forEach((time) => {
    cron.schedule(`0 ${time.split(":")[1]} ${time.split(":")[0]} * * *`, async () => {
      try {
        const users = await db.all(
          "SELECT DISTINCT user_id FROM reminders WHERE target_date IS NULL",
        );

        for (const user of users) {
          const reminders = await db.all(
            "SELECT * FROM reminders WHERE user_id = ? AND target_date IS NULL",
            [user.user_id],
          );

          if (reminders.length > 0) {
            const message = `Your daily reminders:\n${reminders.map((r) => r.content).join("\n")}`;
            void bot.sendMessage(user.user_id, message);
          }
        }
      } catch (error) {
        console.error("Error in daily notification:", error);
      }
    });
  });
}

main().catch((error) => {
  console.error(error);
});
