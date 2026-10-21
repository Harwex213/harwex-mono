import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/database/database.schema.ts",
  out: "./src/database/migrations",
  dbCredentials: {
    url: process.env.AUTH_SERVICE_DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
