import { schema } from "./definition/schema.js";
import { CRON_JOB_IDS } from "./definition/service-ids.js";
import type { TUser } from "../db/types.js";

schema.cron(
  [],
  { id: CRON_JOB_IDS.ALIVE_NOTIFY_ON_START, executeOnStart: true },
  async ({ db }) => {
    const users = await db.all<TUser[]>(`
        SELECT *
        FROM users
        WHERE notify_on_start IS TRUE
    `);

    return users.map(({ chat_id }) => {
      const message = "Bot just started!";
      return [chat_id, message];
    });
  },
);
