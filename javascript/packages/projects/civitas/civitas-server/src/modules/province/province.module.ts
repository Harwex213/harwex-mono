import type { FastifyInstance } from "fastify";
import { database } from "../../database/database";
import { ProvinceController } from "./province.controller";
import {
    addProvinceBodySchema,
    countryProvincesParamsSchema,
    provinceListResponseSchema,
    provinceParamsSchema,
    provinceResponseSchema,
} from "./province.schema";
import { ProvinceService } from "./province.service";

const provinceModule = async (app: FastifyInstance) => {
    const provinceService = new ProvinceService(database);
    const provinceController = new ProvinceController(provinceService);

    app.post("/provinces", {
        schema: {
            body: addProvinceBodySchema,
            response: { 201: provinceResponseSchema },
        },
    }, provinceController.addProvince);

    app.get("/countries/:countryId/provinces", {
        schema: {
            params: countryProvincesParamsSchema,
            response: { 200: provinceListResponseSchema },
        },
    }, provinceController.getProvincesByCountry);

    app.get("/provinces/:id", {
        schema: {
            params: provinceParamsSchema,
            response: { 200: provinceResponseSchema },
        },
    }, provinceController.getProvince);
};

export { provinceModule };
