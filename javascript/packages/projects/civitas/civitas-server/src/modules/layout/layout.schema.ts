import { z } from "zod";

const hexSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((hex) => hex.toLowerCase());
const nameSchema = z.string().trim().min(1).max(255);

const layoutParamsSchema = z.object({
    id: z.uuid(),
});

// Everything a map holds: its countries, each with its provinces. A save sends
// the whole of it and the backend replaces what it held.
const saveLayoutBodySchema = z.object({
    countries: z.array(z.object({
        name: nameSchema,
        hex: hexSchema,
        provinces: z.array(z.object({
            name: nameSchema,
            hex: hexSchema,
        })),
    })),
});

const layoutResponseSchema = z.object({
    countries: z.array(z.object({
        id: z.uuid(),
        name: z.string(),
        hex: z.string(),
        provinces: z.array(z.object({
            id: z.uuid(),
            name: z.string(),
            hex: z.string(),
        })),
    })),
});

type LayoutParams = z.infer<typeof layoutParamsSchema>;
type SaveLayoutBody = z.infer<typeof saveLayoutBodySchema>;
type LayoutResponse = z.infer<typeof layoutResponseSchema>;

export {
    layoutParamsSchema,
    saveLayoutBodySchema,
    layoutResponseSchema,
    type LayoutParams,
    type SaveLayoutBody,
    type LayoutResponse,
};
