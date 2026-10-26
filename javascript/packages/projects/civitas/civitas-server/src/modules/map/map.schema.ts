import { z } from "zod";

const addMapFieldsSchema = z.object({
    name: z.string().trim().min(1).max(255),
});

const mapParamsSchema = z.object({
    id: z.uuid(),
});

const mapResponseSchema = z.object({
    id: z.uuid(),
    name: z.string(),
    image: z.string(),
});

const mapListResponseSchema = z.array(mapResponseSchema);

type MapParams = z.infer<typeof mapParamsSchema>;
type MapResponse = z.infer<typeof mapResponseSchema>;

export {
    addMapFieldsSchema,
    mapParamsSchema,
    mapResponseSchema,
    mapListResponseSchema,
    type MapParams,
    type MapResponse,
};
