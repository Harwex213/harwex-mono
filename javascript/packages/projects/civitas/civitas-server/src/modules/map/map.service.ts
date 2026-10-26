import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { asc, eq } from "drizzle-orm";
import type { DB } from "../../database/database";
import { mapTable, type MapDB } from "../../database/database.schema";
import type { StaticService } from "../static/static.service";
import type { MapResponse } from "./map.schema";

const IMAGE_FILE_NAME = "map.png";

class MapService {
    constructor(
        private readonly db: DB,
        private readonly staticService: StaticService,
    ) {}

    addMap = async (name: string, image: Readable): Promise<MapResponse> => {
        const id = randomUUID();
        try {
            await this.staticService.saveFile(id, IMAGE_FILE_NAME, image);
            const [map] = await this.db.insert(mapTable).values({ id, name }).returning();
            return this.toResponse(map);
        } catch (error) {
            await this.staticService.remove(id);
            throw error;
        }
    };

    getMaps = async (): Promise<MapResponse[]> => {
        const maps = await this.db.select().from(mapTable).orderBy(asc(mapTable.name));
        return maps.map(this.toResponse);
    };

    getMap = async (id: string): Promise<MapResponse | null> => {
        const [map] = await this.db.select().from(mapTable).where(eq(mapTable.id, id));
        if (!map) {
            return null;
        }
        return this.toResponse(map);
    };

    private toResponse = (map: MapDB): MapResponse => {
        return {
            id: map.id,
            name: map.name,
            image: this.staticService.getUrl(map.id, IMAGE_FILE_NAME),
        };
    };
}

export { MapService };
