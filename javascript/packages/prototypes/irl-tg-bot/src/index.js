import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import { config } from "@dotenvx/dotenvx";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { format, isValid, parse } from "date-fns";

// Load environment variables
config();

// Initialize bot
console.log("token", process.env.TELEGRAM_BOT_TOKEN);

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Set up command menu for Telegram clients
bot.setMyCommands([
    { command: "addreminder", description: "Add a new reminder" },
    { command: "dailies", description: "View all your daily reminders" },
    { command: "monthly", description: "View all your reminders for the current month" },
    { command: "deletereminder", description: "Delete a reminder by its ID" }
]);

// Initialize database connection
let db;

// Database initialization
async function initializeDatabase() {
    db = await open({
        filename: "reminders.db",
        driver: sqlite3.Database
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
}

// Command handlers
bot.onText(/\/addreminder (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const input = match[1].trim();

    // Parse input for date if present
    const dateMatch = input.match(/(\d{2}\.\d{2}\.\d{4})/);
    let targetDate = null;
    let content = input;

    if (dateMatch) {
        const dateStr = dateMatch[1];
        const parsedDate = parse(dateStr, "dd.MM.yyyy", new Date());
        if (isValid(parsedDate)) {
            targetDate = parsedDate;
            content = input.replace(dateStr, "").trim();
        }
    }

    try {
        const result = await db.run(
            "INSERT INTO reminders (user_id, content, target_date) VALUES (?, ?, ?)",
            [userId, content, targetDate]
        );

        const response = targetDate
            ? `Reminder set for ${format(targetDate, "dd.MM.yyyy")}: ${content}`
            : `Daily reminder set: ${content}`;

        bot.sendMessage(chatId, response);
    } catch (error) {
        console.error("Error adding reminder:", error);
        bot.sendMessage(chatId, "Sorry, there was an error setting your reminder.");
    }
});

bot.onText(/\/dailies/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    try {
        const reminders = await db.all(
            "SELECT * FROM reminders WHERE user_id = ? AND target_date IS NULL",
            [userId]
        );

        if (reminders.length === 0) {
            bot.sendMessage(chatId, "You have no daily reminders set.");
            return;
        }

        const reminderList = reminders.map(r => `ID: ${r.id} - ${r.content}`).join("\n");
        bot.sendMessage(chatId, `Your daily reminders:\n${reminderList}`);
    } catch (error) {
        console.error("Error fetching daily reminders:", error);
        bot.sendMessage(chatId, "Sorry, there was an error fetching your reminders.");
    }
});

bot.onText(/\/monthly/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    try {
        const reminders = await db.all(
            "SELECT * FROM reminders WHERE user_id = ? AND target_date BETWEEN ? AND ?",
            [userId, startOfMonth.toISOString(), endOfMonth.toISOString()]
        );

        if (reminders.length === 0) {
            bot.sendMessage(chatId, "You have no reminders for this month.");
            return;
        }

        const reminderList = reminders.map(r =>
            `ID: ${r.id} - ${format(new Date(r.target_date), "dd.MM.yyyy")}: ${r.content}`
        ).join("\n");

        bot.sendMessage(chatId, `Your reminders for ${format(now, "MMMM yyyy")}:\n${reminderList}`);
    } catch (error) {
        console.error("Error fetching monthly reminders:", error);
        bot.sendMessage(chatId, "Sorry, there was an error fetching your reminders.");
    }
});

bot.onText(/\/deletereminder (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const reminderId = match[1];

    try {
        const result = await db.run(
            "DELETE FROM reminders WHERE id = ? AND user_id = ?",
            [reminderId, userId]
        );

        if (result.changes === 0) {
            bot.sendMessage(chatId, "Reminder not found or you don't have permission to delete it.");
            return;
        }

        bot.sendMessage(chatId, "Reminder deleted successfully.");
    } catch (error) {
        console.error("Error deleting reminder:", error);
        bot.sendMessage(chatId, "Sorry, there was an error deleting your reminder.");
    }
});

// Scheduler for daily notifications
const notificationTimes = ["09:00", "15:00", "21:00"];

notificationTimes.forEach(time => {
    cron.schedule(`0 ${time.split(":")[1]} ${time.split(":")[0]} * * *`, async () => {
        try {
            const users = await db.all(
                "SELECT DISTINCT user_id FROM reminders WHERE target_date IS NULL"
            );

            for (const user of users) {
                const reminders = await db.all(
                    "SELECT * FROM reminders WHERE user_id = ? AND target_date IS NULL",
                    [user.user_id]
                );

                if (reminders.length > 0) {
                    const message = `Your daily reminders:\n${reminders.map(r => r.content).join("\n")}`;
                    bot.sendMessage(user.user_id, message);
                }
            }
        } catch (error) {
            console.error("Error in daily notification:", error);
        }
    });
});

// Initialize database and start bot
initializeDatabase()
    .then(() => {
        console.log("Database initialized successfully");
        console.log("Bot is running...");
    })
    .catch(error => {
        console.error("Error initializing database:", error);
        process.exit(1);
    });