import type { FastifyReply, FastifyRequest } from "fastify";
import { MapService } from "./map.service";
import { addMapFieldsSchema, type MapParams } from "./map.schema";

class MapController {
    constructor(private readonly mapService: MapService) {}

    addMap = async (request: FastifyRequest, reply: FastifyReply) => {
        const image = await request.file();
        if (!image || image.fieldname !== "image" || image.mimetype !== "image/png") {
            return reply.code(400).send({ message: "\"image\" must be a png file" });
        }

        const name = image.fields.name;
        const fields = addMapFieldsSchema.safeParse({
            name: name && "value" in name ? name.value : undefined,
        });
        if (!fields.success) {
            image.file.resume();
            return reply.code(400).send({ message: fields.error.message });
        }

        const map = await this.mapService.addMap(fields.data.name, image.file);
        return reply.code(201).send(map);
    };

    getMaps = async (_request: FastifyRequest, reply: FastifyReply) => {
        const maps = await this.mapService.getMaps();
        return reply.send(maps);
    };

    getMap = async (request: FastifyRequest<{ Params: MapParams }>, reply: FastifyReply) => {
        const map = await this.mapService.getMap(request.params.id);
        if (!map) {
            return reply.code(404).send({ message: "Map not found" });
        }
        return reply.send(map);
    };
}

export { MapController };
