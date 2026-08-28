import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import type { AppRouter } from "@hw/harwex-notes-protocol";

// The app boundary is the procedure tree, not the client object. Dropping the client's
// private internals lets the mock implement the same contract as a plain object.
type TApiClient = Pick<TRPCClient<AppRouter>, "fs">;

const createTrpcApi = (url: string): TApiClient => createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url })],
});

export type { TApiClient };
export { createTrpcApi };
