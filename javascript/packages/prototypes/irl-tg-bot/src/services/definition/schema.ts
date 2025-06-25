import type { Database } from "sqlite";

type TServiceContext = { db: Database; userId: string; chatId: number; jsonStringify: (data: unknown) => string; };
type TService = (input: string, ctx: TServiceContext) => Promise<string>;
type TServiceMeta = { id: string; description: string; service: TService; };

type TCronServiceContext = { db: Database; jsonStringify: (data: unknown) => string; };
type TCronService = (ctx: TCronServiceContext) => Promise<[string | number, string][]>;
type TCronServiceMeta = { id: string; cron: string[]; executeOnStart: boolean; service: TCronService; };

type TConductorSchema = {
  services: Record<string, TServiceMeta>;
  cronServices: TCronServiceMeta[];
  declare: (meta: { id: string; command: string; description: string; }, service: TService) => void;
  cron: (cron: string[], meta: { id: string; executeOnStart: boolean; }, service: TCronService) => void;
}

const schema: TConductorSchema = {
  services: {},
  cronServices: [],
  declare: ({ id, command, description }, service) => {
    schema.services[command] = { id, description, service };
  },
  cron: (cron, { id, executeOnStart }, service) => {
    schema.cronServices.push({ cron, id, executeOnStart, service });
  },
};

export {
  type TService,
  type TCronService,
  schema,
};
