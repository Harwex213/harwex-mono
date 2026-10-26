import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { mkdir } from "node:fs/promises";
import { STATIC_DIR } from "../../config/env";
import { StaticService, STATIC_URL_PREFIX } from "./static.service";

const staticService = new StaticService(STATIC_DIR);

const staticModule = async (app: FastifyInstance) => {
    await mkdir(STATIC_DIR, { recursive: true });
    await app.register(fastifyStatic, {
        root: STATIC_DIR,
        prefix: `${STATIC_URL_PREFIX}/`,
    });
};

export { staticModule, staticService };
