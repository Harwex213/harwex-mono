import * as path from "node:path";

const SERVICE_PORT_ENV: string | undefined = process.env["SERVICE_PORT"];
const SERVICE_PORT: number = Number(SERVICE_PORT_ENV) > 0 ? Number(SERVICE_PORT_ENV) : 8104;

const DATABASE_URL: string = process.env.SERVICE_DATABASE_URL || "postgresql://root:root@localhost:5432/civitas";

const STATIC_DIR: string = path.resolve(process.env.SERVICE_STATIC_DIR || "static");

export { SERVICE_PORT, DATABASE_URL, STATIC_DIR };
