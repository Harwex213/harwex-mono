import { schema } from "./definition/schema.js";
import { USER_ROLE_ID } from "../db/types.js";
import { SERVICE_IDS } from "./definition/service-ids.js";

schema.declare(
  {
    id: SERVICE_IDS.USER_START,
    command: "start",
    description: "Start new session",
  },
  async (_, ctx) => {
    const { userId, chatId, db } = ctx;

    await db.run(
      "INSERT INTO users (id, chat_id, role_id, notify_on_start) VALUES (?, ?, ?, ?)",
      [userId, chatId, USER_ROLE_ID.ANON, false],
    );

    return "Started new session";
  },
);
