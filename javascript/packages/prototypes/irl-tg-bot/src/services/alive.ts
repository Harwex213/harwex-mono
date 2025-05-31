import { schema } from "../schema";
import type { TUser } from "../db/types";

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
