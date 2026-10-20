const SERVICE_PORT_ENV: string | undefined = process.env["SERVICE_PORT"];
const SERVICE_PORT = Number(SERVICE_PORT_ENV) > 0 ? Number(SERVICE_PORT_ENV) : 8104;

export { SERVICE_PORT };