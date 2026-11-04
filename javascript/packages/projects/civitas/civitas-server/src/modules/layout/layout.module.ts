import type { FastifyInstance } from "fastify";
import { database } from "../../database/database";
import { LayoutController } from "./layout.controller";
import { layoutParamsSchema, layoutResponseSchema, saveLayoutBodySchema } from "./layout.schema";
import { LayoutService } from "./layout.service";

// A detected map holds well over a thousand provinces; fastify's default 1 MiB
// body limit is too tight for that once names are long.
const BODY_LIMIT_BYTES = 16 * 1024 * 1024;

const layoutModule = async (app: FastifyInstance) => {
    const layoutService = new LayoutService(database);
    const layoutController = new LayoutController(layoutService);

    app.get("/maps/:id/layout", {
        schema: {
            params: layoutParamsSchema,
            response: { 200: layoutResponseSchema },
        },
    }, layoutController.getLayout);

    app.put("/maps/:id/layout", {
        bodyLimit: BODY_LIMIT_BYTES,
        schema: {
            params: layoutParamsSchema,
            body: saveLayoutBodySchema,
            response: { 200: layoutResponseSchema },
        },
    }, layoutController.saveLayout);
};

export { layoutModule };
