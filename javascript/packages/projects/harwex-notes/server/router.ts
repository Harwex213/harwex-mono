import { initTRPC } from "@trpc/server";
import { listInputSchema, readInputSchema, writeInputSchema } from "../shared/contract.ts";
import { listDirectory, notesRoot, readTextFile, writeTextFile } from "./workspace.ts";

const t = initTRPC.create();

const appRouter = t.router({
  fs: t.router({
    list: t.procedure.input(listInputSchema).query(({ input }) => {
      return listDirectory(notesRoot(), input.path);
    }),
  }),
  file: t.router({
    read: t.procedure.input(readInputSchema).query(({ input }) => {
      return readTextFile(notesRoot(), input.path);
    }),
    write: t.procedure.input(writeInputSchema).mutation(({ input }) => {
      return writeTextFile(notesRoot(), input.path, input.text, input.baseMtimeMs);
    }),
  }),
});

type AppRouter = typeof appRouter;

export type { AppRouter };
export { appRouter };
