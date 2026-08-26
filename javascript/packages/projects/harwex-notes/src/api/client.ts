import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "../../server/router.ts";

const api = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/trpc",
    }),
  ],
});

/** The tRPC error code, when the failure came back from the server at all. */
function errorCode(error: unknown): string | null {
  if (error instanceof TRPCClientError) {
    const data = error.data as { code?: string } | null | undefined;
    return data?.code ?? null;
  }
  return null;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export { api, describeError, errorCode };
