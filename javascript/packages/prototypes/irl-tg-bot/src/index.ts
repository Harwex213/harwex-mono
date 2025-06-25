import TelegramBot from "node-telegram-bot-api";
import { config } from "@dotenvx/dotenvx";
import cron from "node-cron";
import { schema, type TCronService } from "./services/definition/schema.js";
import { initializeFileDatabase } from "./db/init.js";
import { logger } from "./logger.js";
import "./services/index.js";

async function main() {
  config();

  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  logger.debug("token", botToken);

  if (!botToken) {
    throw new Error("No bot token provided");
  }

  const db = await initializeFileDatabase();

  logger.info("Database initialized successfully");

  const bot = new TelegramBot(botToken, { polling: true });

  const commands = Object.entries(schema.services).map(([command, service]) => ({
    command,
    description: service.description,
  }));

  await bot.setMyCommands(commands);

  logger.info("Bot is running...");

  const handleMessage = async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
    if (!match || !msg.from) {
      return;
    }

    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const command = match[1]?.trim() || "";
    const input = match[2]?.trim() || "";

    const service = schema.services[command];
    if (!service) {
      return;
    }

    try {
      const response = await service.service(input, {
        userId,
        chatId,
        db,
        jsonStringify: JSON.stringify,
      });
      await bot.sendMessage(chatId, response);
    } catch (e) {
      await bot.sendMessage(chatId, "Cannot handle command with such parameters. Check your inputs");
    }
  };

  bot.onText(/\/(\S+) (.+)/, handleMessage);
  bot.onText(/\/(\S+)$/, handleMessage);

  const handleCronFactory = (cronService: TCronService) => async () => {
    try {
      const results = await cronService({
        db,
        jsonStringify: JSON.stringify,
      });

      for (const [chatId, response] of results) {
        void bot.sendMessage(chatId, response);
      }
    } catch (error) {
      logger.error("Error during processing cron", error);
    }
  };

  for (const cronService of schema.cronServices) {
    const handleCron = handleCronFactory(cronService.service);

    if (cronService.executeOnStart) {
      void handleCron();
    }

    for (const cronTime of cronService.cron) {
      cron.schedule(cronTime, handleCron);
    }
  }
}

main().catch((error) => {
  logger.error(error);
});
