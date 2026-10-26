import fastifyMultipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { database } from "../../database/database";
import { staticService } from "../static/static.module";
import { MapController } from "./map.controller";
import { mapListResponseSchema, mapParamsSchema, mapResponseSchema } from "./map.schema";
import { MapService } from "./map.service";

const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;

const mapModule = async (app: FastifyInstance) => {
    const mapService = new MapService(database, staticService);
    const mapController = new MapController(mapService);

    await app.register(fastifyMultipart, {
        limits: {
            fileSize: MAX_FILE_SIZE_BYTES,
            files: 1,
        },
    });

    app.post("/maps", {
        schema: {
            response: { 201: mapResponseSchema },
        },
    }, mapController.addMap);

    app.get("/maps", {
        schema: {
            response: { 200: mapListResponseSchema },
        },
    }, mapController.getMaps);

    app.get("/maps/:id", {
        schema: {
            params: mapParamsSchema,
            response: { 200: mapResponseSchema },
        },
    }, mapController.getMap);
};

export { mapModule };
