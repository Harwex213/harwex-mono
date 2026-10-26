import { drizzle } from "drizzle-orm/node-postgres";
import { DATABASE_URL } from "../config/env";

const database = drizzle(DATABASE_URL);

type Transaction = Parameters<Parameters<typeof database.transaction>[0]>[0];

type DB = typeof database | Transaction;

export { database, type Transaction, type DB };
