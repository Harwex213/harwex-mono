import { router } from "../trpc.js";
import { fsRouter } from "./fs.js";

const appRouter = router({
  fs: fsRouter,
});

type AppRouter = typeof appRouter;

export { appRouter };
export type { AppRouter };
