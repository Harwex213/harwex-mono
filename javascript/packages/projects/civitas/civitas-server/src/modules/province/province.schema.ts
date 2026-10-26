import { z } from "zod";

const addProvinceBodySchema = z.object({
    name: z.string().trim().min(1).max(255),
    hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((hex) => hex.toLowerCase()),
    countryId: z.uuid(),
});

const provinceParamsSchema = z.object({
    id: z.uuid(),
});

const countryProvincesParamsSchema = z.object({
    countryId: z.uuid(),
});

const provinceResponseSchema = z.object({
    id: z.uuid(),
    name: z.string(),
    hex: z.string(),
    countryId: z.uuid().nullable(),
});

const provinceListResponseSchema = z.array(provinceResponseSchema);

type AddProvinceBody = z.infer<typeof addProvinceBodySchema>;
type ProvinceParams = z.infer<typeof provinceParamsSchema>;
type CountryProvincesParams = z.infer<typeof countryProvincesParamsSchema>;

export {
    addProvinceBodySchema,
    provinceParamsSchema,
    countryProvincesParamsSchema,
    provinceResponseSchema,
    provinceListResponseSchema,
    type AddProvinceBody,
    type ProvinceParams,
    type CountryProvincesParams,
};
