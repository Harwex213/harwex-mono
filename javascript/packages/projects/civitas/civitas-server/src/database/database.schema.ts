import { pgTable, uuid, varchar } from "drizzle-orm/pg-core";

const mapTable = pgTable("maps", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).unique().notNull(),
});

const countryTable = pgTable("countries", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).unique().notNull(),
    mapId: uuid("map_id").references(() => mapTable.id),
})

const provinceTable = pgTable("provinces", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).unique().notNull(),
    hex: varchar("hex", { length: 255 }).unique().notNull(),
    countryId: uuid("country_id").references(() => countryTable.id),
})

type MapDB = typeof mapTable.$inferSelect;
type NewMapDB = typeof mapTable.$inferInsert;

type CountryDB = typeof countryTable.$inferSelect;
type NewCountryDB = typeof countryTable.$inferInsert;

type ProvinceDB = typeof provinceTable.$inferSelect;
type NewProvinceDB = typeof provinceTable.$inferInsert;

export {
    mapTable,
    countryTable,
    provinceTable,
    type MapDB,
    type NewMapDB,
    type CountryDB,
    type NewCountryDB,
    type ProvinceDB,
    type NewProvinceDB
}
