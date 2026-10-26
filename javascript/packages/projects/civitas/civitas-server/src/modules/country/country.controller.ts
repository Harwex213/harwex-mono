import type { FastifyReply, FastifyRequest } from "fastify";
import { CountryService } from "./country.service";
import type { AddCountryBody, CountryParams, MapCountriesParams } from "./country.schema";

class CountryController {
    constructor(private readonly countryService: CountryService) {}

    addCountry = async (request: FastifyRequest<{ Body: AddCountryBody }>, reply: FastifyReply) => {
        const country = await this.countryService.addCountry(request.body);
        if (!country) {
            return reply.code(404).send({ message: "Map not found" });
        }
        return reply.code(201).send(country);
    };

    getCountry = async (request: FastifyRequest<{ Params: CountryParams }>, reply: FastifyReply) => {
        const country = await this.countryService.getCountry(request.params.id);
        if (!country) {
            return reply.code(404).send({ message: "Country not found" });
        }
        return reply.send(country);
    };

    getCountriesByMap = async (request: FastifyRequest<{ Params: MapCountriesParams }>, reply: FastifyReply) => {
        const countries = await this.countryService.getCountriesByMap(request.params.mapId);
        return reply.send(countries);
    };
}

export { CountryController };
