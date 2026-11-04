import { z } from "zod";

// The layers painted over a map: the province layer and the countries view of
// it. Each is a png of the map's size, transparent where nothing is painted.
const MAP_LAYERS = ["provinces", "countries"] as const;

const addMapFieldsSchema = z.object({
    name: z.string().trim().min(1).max(255),
});

const mapParamsSchema = z.object({
    id: z.uuid(),
});

const mapLayerParamsSchema = z.object({
    id: z.uuid(),
    layer: z.enum(MAP_LAYERS),
});

const mapResponseSchema = z.object({
    id: z.uuid(),
    name: z.string(),
    image: z.string(),
    // Null until the layer is first saved.
    provincesImage: z.string().nullable(),
    countriesImage: z.string().nullable(),
});

const mapListResponseSchema = z.array(mapResponseSchema);

type MapLayer = (typeof MAP_LAYERS)[number];
type MapParams = z.infer<typeof mapParamsSchema>;
type MapLayerParams = z.infer<typeof mapLayerParamsSchema>;
type MapResponse = z.infer<typeof mapResponseSchema>;

export {
    MAP_LAYERS,
    addMapFieldsSchema,
    mapParamsSchema,
    mapLayerParamsSchema,
    mapResponseSchema,
    mapListResponseSchema,
    type MapLayer,
    type MapParams,
    type MapLayerParams,
    type MapResponse,
};
