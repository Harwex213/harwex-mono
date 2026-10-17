import { router } from "../trpc.js";
import { fsRouter } from "./fs.js";
import { stateRouter } from "./state.js";

const appRouter = router({
  fs: fsRouter,
  state: stateRouter,
});

type AppRouter = typeof appRouter;

export { appRouter };
export type { AppRouter };
