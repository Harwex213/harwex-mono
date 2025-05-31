import type { Database } from "sqlite";

/**
 * Creates a mock context for testing services
 */
export function mockServiceContext(db: Database, overrides: Partial<{
  userId: string;
  chatId: number;
  jsonStringify: (data: unknown) => string;
}> = {}) {
  return {
    db,
    userId: "123456789",
    chatId: 987654321,
    jsonStringify: JSON.stringify,
    ...overrides,
  };
}

/**
 * Common test data for user-related tests
 */
export const TEST_DATA = {
  users: {
    validNumericId: "123456789",
    anotherValidId: "555666777",
    invalidNonNumericId: "not_a_number",
    emptyId: "",
  },
  chatIds: {
    positive: 987654321,
    negative: -1001234567890, // Telegram group format
    zero: 0,
  },
} as const;
