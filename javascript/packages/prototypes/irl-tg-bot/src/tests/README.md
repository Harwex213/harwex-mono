# Tests

This directory contains tests for the IRL Telegram Bot services.

## Running Tests

To run all tests:

```bash
npm test
```

## Test Structure

- `services/` - Contains tests for individual services
    - `user.test.ts` - Tests for the user service (start command)
    - `reminder.test.ts` - Tests for the reminder service (placeholder)
- `test-db.ts` - Database utilities for testing
- `test-env.ts` - Common test utilities and configurations

## Test Framework

The tests use Node.js built-in test runner with TypeScript support via `tsx`.

## Database Testing

### Schema Synchronization

Tests use the **same database schema as production** to ensure consistency:

- Production schema is defined in `src/db/schema.ts`
- Test databases are created using `setupTestDatabase()` from `test-db.ts`
- Both production and test environments use `applyDatabaseSchema()` function
- This ensures that any schema changes are automatically reflected in tests

### Database Utilities

- `setupTestDatabase()` - Creates a clean in-memory database for each test
- `teardownTestDatabase()` - Properly closes test databases

## Test Utilities

### Mock Context Creation

```typescript
import { createMockContext, TEST_DATA } from "../test-env";

const context = createMockContext(db, {
  userId: TEST_DATA.users.validNumericId,
  chatId: TEST_DATA.chatIds.positive,
});
```

### Common Test Data

Predefined test data is available in `TEST_DATA`:

- `TEST_DATA.users` - Various user ID scenarios
- `TEST_DATA.chatIds` - Different chat ID formats

### Assertions

- `assertUserExists()` - Comprehensive user record validation

## Adding New Tests

When adding new service tests:

1. **Import test utilities**:
   ```typescript
   import { setupTestDatabase, teardownTestDatabase } from "../test-db";
   import { createMockContext, TEST_DATA } from "../test-env";
   ```

2. **Use standard setup/teardown**:
   ```typescript
   beforeEach(async () => {
     db = await setupTestDatabase();
   });
   
   afterEach(async () => {
     await teardownTestDatabase(db);
   });
   ```

3. **Create contexts with utilities**:
   ```typescript
   const context = createMockContext(db, { userId: TEST_DATA.users.validNumericId });
   ```

4. **Test both success and error cases**
5. **Use shared assertions** where applicable

This architecture ensures that tests remain maintainable and synchronized with production as the application evolves. 