import { z } from "zod";

const addCountryBodySchema = z.object({
    name: z.string().trim().min(1).max(255),
    mapId: z.uuid(),
});

const countryParamsSchema = z.object({
    id: z.uuid(),
});

const mapCountriesParamsSchema = z.object({
    mapId: z.uuid(),
});

const countryResponseSchema = z.object({
    id: z.uuid(),
    name: z.string(),
    mapId: z.uuid().nullable(),
});

const countryListResponseSchema = z.array(countryResponseSchema);

type AddCountryBody = z.infer<typeof addCountryBodySchema>;
type CountryParams = z.infer<typeof countryParamsSchema>;
type MapCountriesParams = z.infer<typeof mapCountriesParamsSchema>;

export {
    addCountryBodySchema,
    countryParamsSchema,
    mapCountriesParamsSchema,
    countryResponseSchema,
    countryListResponseSchema,
    type AddCountryBody,
    type CountryParams,
    type MapCountriesParams,
};
