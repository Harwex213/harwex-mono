import { initTRPC } from "@trpc/server";
import type { CreateHTTPContextOptions } from "@trpc/server/adapters/standalone";

interface Context {
  requestId: string;
}

function createContext(_opts: CreateHTTPContextOptions): Context {
  return {
    requestId: crypto.randomUUID(),
  };
}

const t = initTRPC.context<Context>().create();

const router = t.router;
const publicProcedure = t.procedure;

export { createContext, router, publicProcedure };
export type { Context };
