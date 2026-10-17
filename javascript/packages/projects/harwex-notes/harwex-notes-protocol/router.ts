// The type of the backend's tRPC router, for the one consumer that builds a tRPC client.
// It is a separate entry so that importing the shared types from `exports.ts` never pulls
// the backend's Node sources into a browser-only type check.
// The backend is Node code (`node:path`, `node:sqlite`), so its types need the Node ones.
/// <reference types="node" />

export type { AppRouter } from "@hw/harwex-notes-backend/router";
