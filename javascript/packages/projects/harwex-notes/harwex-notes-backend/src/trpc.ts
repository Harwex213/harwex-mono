import { initTRPC } from "@trpc/server";
import type { FsDataAccess } from "./data-access/fs-data-access.types.js";

type TContext = {
  dataAccess: FsDataAccess;
};

const t = initTRPC.context<TContext>().create();

const router = t.router;
const publicProcedure = t.procedure;

export { router, publicProcedure };
export type { TContext };
