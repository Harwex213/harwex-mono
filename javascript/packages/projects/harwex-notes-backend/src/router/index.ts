import { router } from "../trpc.js";
import { notesRouter } from "./notes.js";

const appRouter = router({
  notes: notesRouter,
});

type AppRouter = typeof appRouter;

export { appRouter };
export type { AppRouter };
