import { asc, eq, inArray } from "drizzle-orm";
import { database, type DB } from "../../database/database";
import { countryTable, mapTable, provinceTable } from "../../database/database.schema";
import type { LayoutResponse, SaveLayoutBody } from "./layout.schema";

// Thrown when a body repeats a name or a hex. Those are unique in the database,
// so the save would fail half-way through anyway.
class LayoutConflictError extends Error {}

function firstRepeat(values: readonly string[]): string | null {
    const seen = new Set<string>();
    for (const value of values) {
        if (seen.has(value)) {
            return value;
        }
        seen.add(value);
    }
    return null;
}

function checkUnique(body: SaveLayoutBody): void {
    const provinces = body.countries.flatMap((country) => country.provinces);
    const checks: Array<[string, string[]]> = [
        ["country name", body.countries.map((country) => country.name)],
        ["country hex", body.countries.map((country) => country.hex)],
        ["province name", provinces.map((province) => province.name)],
        ["province hex", provinces.map((province) => province.hex)],
    ];
    for (const [what, values] of checks) {
        const repeat = firstRepeat(values);
        if (repeat !== null) {
            throw new LayoutConflictError(`${what} "${repeat}" is used twice`);
        }
    }
}

class LayoutService {
    constructor(private readonly db: typeof database) {}

    // Null when the map does not exist.
    getLayout = async (mapId: string, db: DB = this.db): Promise<LayoutResponse | null> => {
        const [map] = await db.select({ id: mapTable.id }).from(mapTable).where(eq(mapTable.id, mapId));
        if (!map) {
            return null;
        }
        const countries = await db.select().from(countryTable).where(eq(countryTable.mapId, mapId)).orderBy(asc(countryTable.name));
        const provinces = countries.length === 0
            ? []
            : await db.select().from(provinceTable).where(inArray(provinceTable.countryId, countries.map((country) => country.id))).orderBy(asc(provinceTable.name));
        return {
            countries: countries.map((country) => ({
                id: country.id,
                name: country.name,
                hex: country.hex,
                provinces: provinces
                    .filter((province) => province.countryId === country.id)
                    .map((province) => ({ id: province.id, name: province.name, hex: province.hex })),
            })),
        };
    };

    // Replaces every country and province of the map with the body, in one
    // transaction: whatever the body leaves out is deleted. Null when the map
    // does not exist.
    saveLayout = async (mapId: string, body: SaveLayoutBody): Promise<LayoutResponse | null> => {
        checkUnique(body);
        return this.db.transaction(async (tx) => {
            const [map] = await tx.select({ id: mapTable.id }).from(mapTable).where(eq(mapTable.id, mapId)).for("update");
            if (!map) {
                return null;
            }

            const old = await tx.select({ id: countryTable.id }).from(countryTable).where(eq(countryTable.mapId, mapId));
            if (old.length > 0) {
                const ids = old.map((country) => country.id);
                await tx.delete(provinceTable).where(inArray(provinceTable.countryId, ids));
                await tx.delete(countryTable).where(inArray(countryTable.id, ids));
            }

            for (const country of body.countries) {
                const [created] = await tx.insert(countryTable).values({ name: country.name, hex: country.hex, mapId }).returning({ id: countryTable.id });
                if (country.provinces.length > 0) {
                    await tx.insert(provinceTable).values(country.provinces.map((province) => ({
                        name: province.name,
                        hex: province.hex,
                        countryId: created.id,
                    })));
                }
            }

            return this.getLayout(mapId, tx);
        });
    };
}

export { LayoutConflictError, LayoutService };
