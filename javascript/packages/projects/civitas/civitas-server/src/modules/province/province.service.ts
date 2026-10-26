import { asc, eq } from "drizzle-orm";
import type { DB } from "../../database/database";
import { countryTable, provinceTable, type ProvinceDB } from "../../database/database.schema";
import type { AddProvinceBody } from "./province.schema";

class ProvinceService {
    constructor(private readonly db: DB) {}

    // Returns null when the country does not exist.
    addProvince = async (body: AddProvinceBody): Promise<ProvinceDB | null> => {
        const [country] = await this.db.select({ id: countryTable.id }).from(countryTable).where(eq(countryTable.id, body.countryId));
        if (!country) {
            return null;
        }
        const [province] = await this.db.insert(provinceTable).values(body).returning();
        return province;
    };

    getProvince = async (id: string): Promise<ProvinceDB | null> => {
        const [province] = await this.db.select().from(provinceTable).where(eq(provinceTable.id, id));
        return province ?? null;
    };

    getProvincesByCountry = async (countryId: string): Promise<ProvinceDB[]> => {
        return this.db.select().from(provinceTable).where(eq(provinceTable.countryId, countryId)).orderBy(asc(provinceTable.name));
    };
}

export { ProvinceService };
