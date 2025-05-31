import type { Database } from "sqlite";

type TServiceContext = { db: Database; userId: string; chatId: number; jsonStringify: (data: unknown) => string; };
type TService = (input: string, ctx: TServiceContext) => Promise<string>;
type TServiceMeta = { description: string; service: TService; };

type TCronServiceContext = { db: Database; jsonStringify: (data: unknown) => string; };
type TCronService = (ctx: TCronServiceContext) => Promise<[string | number, string][]>;
type TCronServiceMeta = { cron: string[]; executeOnStart: boolean; service: TCronService; };

type TConductorSchema = {
  services: Record<string, TServiceMeta>;
  cronServices: TCronServiceMeta[];
  declare: (command: string, description: string, service: TService) => void;
  cron: (cron: string[], executeOnStart: boolean, service: TCronService) => void;
}

const schema: TConductorSchema = {
  services: {},
  cronServices: [],
  declare: (command, description, service) => {
    schema.services[command] = { description, service };
  },
  cron: (cron, executeOnStart, service) => {
    schema.cronServices.push({ cron, executeOnStart, service });
  },
};

export {
  type TService,
  type TCronService,
  schema,
};
