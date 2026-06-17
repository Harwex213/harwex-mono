import type { Database } from "sqlite";

export const buildProcessedRequestId = (messageId: number, fromId: number): string => {
    return `${messageId}_${fromId}`;
};

export const tryClaimProcessedRequest = async (db: Database, id: string): Promise<boolean> => {
    const result = await db.run("INSERT OR IGNORE INTO ProcessedRequest (id) VALUES (?)", id);
    return (result.changes ?? 0) > 0;
};
