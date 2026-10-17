import { initTRPC } from "@trpc/server";
import type { FsDataAccess } from "./data-access/fs-data-access.types.js";
import type { StateStore } from "./data-access/state-store.js";
import type { TVaultChanges } from "./service/sync-service.js";

type TContext = {
  dataAccess: FsDataAccess;
  stateStore: StateStore;
  // Changes made to the vault outside the app. Absent where nothing watches the vault,
  // such as the in-memory sample vault and the tests.
  vaultChanges?: TVaultChanges;
};

// The change stream is a server-sent event stream. A ping every few seconds keeps proxies
// from closing an idle stream, and lets the client notice a backend that went away
// without closing it: no ping for a while counts as a lost connection (SYNC-7).
const SSE_PING_INTERVAL_MS = 5000;
const SSE_CLIENT_RECONNECT_AFTER_MS = 12000;

const t = initTRPC.context<TContext>().create({
  sse: {
    ping: { enabled: true, intervalMs: SSE_PING_INTERVAL_MS },
    client: { reconnectAfterInactivityMs: SSE_CLIENT_RECONNECT_AFTER_MS },
  },
});

const router = t.router;
const publicProcedure = t.procedure;

export { router, publicProcedure };
export type { TContext };
