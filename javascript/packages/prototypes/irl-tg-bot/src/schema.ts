import type { Database } from "sqlite";

type TServiceSendMessageHandler = (chatId: number, message: string) => Promise<void>;
type TServiceContext = { db: Database; sendMessage: TServiceSendMessageHandler; chatId: number; userId: string; };

type TService = (input: string, ctx: TServiceContext) => Promise<void>;
type TServiceMeta = { description: string; service: TService; };

type TConductorSchema = {
  services: Record<string, TServiceMeta>;
  declare: (command: string, description: string, service: TService) => void;
}

const schema: TConductorSchema = {
  services: {},
  declare: (command, description, service) => {
    schema.services[command] = { description, service };
  },
};

export {
  type TService,
  schema,
};
