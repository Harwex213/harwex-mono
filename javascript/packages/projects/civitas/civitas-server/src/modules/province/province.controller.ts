import type { FastifyReply, FastifyRequest } from "fastify";
import { ProvinceService } from "./province.service";
import type { AddProvinceBody, ProvinceParams, CountryProvincesParams } from "./province.schema";

class ProvinceController {
    constructor(private readonly provinceService: ProvinceService) {}

    addProvince = async (request: FastifyRequest<{ Body: AddProvinceBody }>, reply: FastifyReply) => {
        const province = await this.provinceService.addProvince(request.body);
        if (!province) {
            return reply.code(404).send({ message: "Country not found" });
        }
        return reply.code(201).send(province);
    };

    getProvince = async (request: FastifyRequest<{ Params: ProvinceParams }>, reply: FastifyReply) => {
        const province = await this.provinceService.getProvince(request.params.id);
        if (!province) {
            return reply.code(404).send({ message: "Province not found" });
        }
        return reply.send(province);
    };

    getProvincesByCountry = async (request: FastifyRequest<{ Params: CountryProvincesParams }>, reply: FastifyReply) => {
        const provinces = await this.provinceService.getProvincesByCountry(request.params.countryId);
        return reply.send(provinces);
    };
}

export { ProvinceController };
