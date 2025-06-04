import { schema } from "../schema.js";
import type { TUser } from "../db/types.js";

schema.cron(
  [],
  true,
  async ({ db }) => {
    const users = await db.all<TUser[]>(`
        SELECT *
        FROM users
    `);

    return users.map(({ chat_id }) => {
      const message = "Bot just started!";
      return [chat_id, message];
    });
  },
);
