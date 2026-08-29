/**
 * Library entry. Only `src/core` is re-exported: it has no DOM and depends only
 * on `@hw/ostrov-island-system`, so it can be consumed by any bundler, `tsx`,
 * or a node script. The React app under `src/app` is a consumer of this entry,
 * not part of it.
 */
export * from "./src/core/exports";
