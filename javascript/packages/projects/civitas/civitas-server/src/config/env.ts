const SERVICE_PORT_ENV: string | undefined = process.env["SERVICE_PORT"];
const SERVICE_PORT: number = Number(SERVICE_PORT_ENV) > 0 ? Number(SERVICE_PORT_ENV) : 8104;

const DATABASE_URL: string = process.env.SERVICE_DATABASE_URL || "postgresql://root:root@localhost:5432/civitas";

export { SERVICE_PORT, DATABASE_URL };