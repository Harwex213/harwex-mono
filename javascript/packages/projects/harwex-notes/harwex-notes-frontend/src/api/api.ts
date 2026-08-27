import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import type { AppRouter } from "@hw/harwex-notes-protocol";

type TApiClient = TRPCClient<AppRouter>;

const createTrpcApi = (url: string): TApiClient => createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url })],
});

export type { TApiClient };
export { createTrpcApi };
