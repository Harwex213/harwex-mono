import { initializeFileDatabase } from "../src/db/init.js";

const runMigration = async () => {
    const db = await initializeFileDatabase();
    await db.migrate();
    await db.close();
};

runMigration().catch((err) => {
    console.error(err);
    process.exit(1);
});
