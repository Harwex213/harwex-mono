import { initTRPC } from "@trpc/server";
import type { TFsStore } from "./fsStore.js";

type TContext = {
  fs: TFsStore;
};

const t = initTRPC.context<TContext>().create();

const router = t.router;
const publicProcedure = t.procedure;

export { router, publicProcedure };
export type { TContext };
