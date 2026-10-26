import type { FastifyInstance } from "fastify";
import { database } from "../../database/database";
import { CountryController } from "./country.controller";
import {
    addCountryBodySchema,
    countryListResponseSchema,
    countryParamsSchema,
    countryResponseSchema,
    mapCountriesParamsSchema,
} from "./country.schema";
import { CountryService } from "./country.service";

const countryModule = async (app: FastifyInstance) => {
    const countryService = new CountryService(database);
    const countryController = new CountryController(countryService);

    app.post("/countries", {
        schema: {
            body: addCountryBodySchema,
            response: { 201: countryResponseSchema },
        },
    }, countryController.addCountry);

    app.get("/maps/:mapId/countries", {
        schema: {
            params: mapCountriesParamsSchema,
            response: { 200: countryListResponseSchema },
        },
    }, countryController.getCountriesByMap);

    app.get("/countries/:id", {
        schema: {
            params: countryParamsSchema,
            response: { 200: countryResponseSchema },
        },
    }, countryController.getCountry);
};

export { countryModule };
