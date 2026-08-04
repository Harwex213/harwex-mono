// The ordered migration chain that carries an older stored document up to the
// current `STATE_VERSION`. Pure.

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

// Empty on purpose: version 1 is the first shipped schema, so nothing exists to
// migrate FROM yet. When T11 gives economics a real shape and stored documents
// have to be reshaped, bump `STATE_VERSION` to 2 and push
// `{ from: 1, to: 2, migrate }` here. The chain below is exercised by a test
// with a synthetic chain, so the loop is not dead code.
const MIGRATIONS: readonly Migration[] = [];

// A malformed chain is a programmer error and must be loud, not a silent skip
// that leaves a half-migrated document behind.
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
  // `readState` handles the newer-document case before it calls here, so this is
  // a guard rather than a path.
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
