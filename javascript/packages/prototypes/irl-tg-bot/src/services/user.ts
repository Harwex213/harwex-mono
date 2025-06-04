import { schema } from "../schema.js";

schema.declare(
  "start",
  "Start new session",
  async (_, ctx) => {
    const { userId, chatId, db } = ctx;

    await db.run(
      "INSERT INTO users (id, chat_id) VALUES (?, ?)",
      [userId, chatId],
    );

    return "Started new session";
  },
);
