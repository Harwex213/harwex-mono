/**
 * Library entry. Only `src/core` is re-exported: it has no dependencies and no
 * DOM, so it can be consumed by any bundler, `tsx`, or a node script.
 * The React app under `src/app` is a consumer of this entry, not part of it.
 */
export * from "./src/core/exports";
