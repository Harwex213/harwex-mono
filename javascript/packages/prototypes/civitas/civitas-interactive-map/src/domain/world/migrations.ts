// Migration chain from an older stored document to `STATE_VERSION`. Pure.

type MigrationDoc = { [key: string]: unknown };

type Migration = {
  from: number;
  to: number;
  migrate(doc: MigrationDoc): MigrationDoc;
};

type MigrationResult = {
  doc: MigrationDoc;
  applied: number[];
};

// Empty: version 1 is the first schema. To reshape stored documents, bump
// `STATE_VERSION` and add `{ from: 1, to: 2, migrate }`. Tests use a synthetic chain.
const MIGRATIONS: readonly Migration[] = [];

// A malformed chain throws, so a half-migrated document never survives.
function assertChain(chain: readonly Migration[]): void {
  let previousFrom = Number.NEGATIVE_INFINITY;
  for (const step of chain) {
    if (step.to !== step.from + 1) {
      throw new Error(
        "migration " + step.from + " -> " + step.to + " must move exactly one version",
      );
    }
    if (step.from === previousFrom) {
      throw new Error("two migrations start from state version " + step.from);
    }
    if (step.from < previousFrom) {
      throw new Error("migrations must be ordered by ascending `from`, got " + step.from);
    }
    previousFrom = step.from;
  }
}

function runMigrations(
  doc: MigrationDoc,
  fromVersion: number,
  targetVersion: number,
  chain: readonly Migration[] = MIGRATIONS,
): MigrationResult {
  assertChain(chain);

  if (fromVersion === targetVersion) {
    return { doc, applied: [] };
  }
  // Guard only: `readState` handles a newer document before this call.
  if (fromVersion > targetVersion) {
    throw new Error(
      "state version " + fromVersion + " is newer than this build's " + targetVersion,
    );
  }

  const applied: number[] = [];
  let current = fromVersion;
  let migrated = doc;

  while (current < targetVersion) {
    const step = chain.find((candidate) => {
      return candidate.from === current;
    });
    if (!step) {
      throw new Error("no migration from state version " + current);
    }
    migrated = step.migrate(migrated);
    applied.push(step.from);
    current = step.to;
  }

  return { doc: migrated, applied };
}

export {
  MIGRATIONS,
  assertChain,
  runMigrations,
  type Migration,
  type MigrationDoc,
  type MigrationResult,
};
