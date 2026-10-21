import { pgTable, uuid, varchar } from "drizzle-orm/pg-core";

const mapTable = pgTable("maps", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).unique().notNull(),
});

const countryTable = pgTable("countries", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).unique().notNull(),
})

const provinceTable = pgTable("provinces", {})

type UserDB = typeof usersTable.$inferSelect;
type NewUserDB = typeof usersTable.$inferInsert;

export {
    usersTable,
    type UserDB,
    type NewUserDB,
};
