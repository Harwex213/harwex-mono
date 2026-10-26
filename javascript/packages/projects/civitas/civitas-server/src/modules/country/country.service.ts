import { asc, eq } from "drizzle-orm";
import type { DB } from "../../database/database";
import { countryTable, mapTable, type CountryDB } from "../../database/database.schema";
import type { AddCountryBody } from "./country.schema";

class CountryService {
    constructor(private readonly db: DB) {}

    // Returns null when the map does not exist.
    addCountry = async (body: AddCountryBody): Promise<CountryDB | null> => {
        const [map] = await this.db.select({ id: mapTable.id }).from(mapTable).where(eq(mapTable.id, body.mapId));
        if (!map) {
            return null;
        }
        const [country] = await this.db.insert(countryTable).values(body).returning();
        return country;
    };

    getCountry = async (id: string): Promise<CountryDB | null> => {
        const [country] = await this.db.select().from(countryTable).where(eq(countryTable.id, id));
        return country ?? null;
    };

    getCountriesByMap = async (mapId: string): Promise<CountryDB[]> => {
        return this.db.select().from(countryTable).where(eq(countryTable.mapId, mapId)).orderBy(asc(countryTable.name));
    };
}

export { CountryService };
