import {
  createTRPCClient,
  httpBatchLink,
  httpLink,
  httpSubscriptionLink,
  splitLink,
  type TRPCClient,
} from "@trpc/client";
import type { AppRouter } from "@hw/harwex-notes-protocol/router";

// The app boundary is the procedure tree, not the client object. Dropping the client's
// private internals lets the mock implement the same contract as a plain object.
// The one call that is not a procedure: the URL the browser loads a vault file from by
// itself, such as an image inside a Markdown file (MD-5). It is synchronous because an
// <img> needs its src while it renders. `path` is the file's vault path with "/"
// separators; the mock finds its data URL by `nodeId` instead. `version` is the file's
// version on disk once it changed; a new one gives a new URL, so the browser loads the file
// again.
type TRawApi = {
  url: (input: { nodeId: string; path: string; version?: string }) => string;
};

type TApiClient = Pick<TRPCClient<AppRouter>, "fs" | "state"> & { raw: TRawApi };

// A request sent while the page is hidden may outlive the page, so a save made on the
// way out still lands (APP-6). Browsers cap the bodies of all such requests in flight at
// 64 KB together. A larger body goes out as a normal request, and so does a request the
// browser refuses to keep alive.
const KEEPALIVE_MAX_BODY_CHARS = 16 * 1024;

const fetchWithKeepalive: typeof fetch = async (input, init) => {
  const body = init?.body;
  const isSmallBody =
    body === undefined ||
    body === null ||
    (typeof body === "string" && body.length <= KEEPALIVE_MAX_BODY_CHARS);

  if (!isSmallBody) {
    return fetch(input, init);
  }

  try {
    return await fetch(input, { ...init, keepalive: true });
  } catch (error) {
    if (init?.signal?.aborted) {
      throw error;
    }

    return fetch(input, init);
  }
};

// The batch link sends on a timer, and a page that is closing runs no more timers. While
// the page is hidden or closing, each call goes out at once, on its own. A reload can
// fire `pagehide` while the page still counts as visible, so that event is tracked too.
// main.tsx creates the api before it adds its own `pagehide` listener, so this flag is set
// before the last saves start.
const createTrpcApi = (url: string): TApiClient => {
  let isPageClosing = false;

  window.addEventListener("pagehide", () => {
    isPageClosing = true;
  });
  window.addEventListener("pageshow", () => {
    isPageClosing = false;
  });

  // Changes made to the vault outside the app arrive as a server-sent event stream
  // (SYNC-1). Every other call is a plain request.
  const client = createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => op.type === "subscription",
        true: httpSubscriptionLink({ url }),
        false: splitLink({
          condition: () => isPageClosing || document.visibilityState === "hidden",
          true: httpLink({ url, fetch: fetchWithKeepalive }),
          false: httpBatchLink({ url }),
        }),
      }),
    ],
  });

  // The backend serves raw files next to the tRPC route, under `<url>/raw/`.
  const raw: TRawApi = {
    url: ({ path, version }) => {
      const encoded = path.split("/").map((segment) => encodeURIComponent(segment));
      const query = version === undefined ? "" : `?v=${encodeURIComponent(version)}`;

      return `${url}/raw/${encoded.join("/")}${query}`;
    },
  };

  // The client is a proxy that turns every property into a procedure path, so `raw` cannot
  // be assigned onto it. A second proxy answers `raw` and hands every other key through.
  return new Proxy(client, {
    get: (target, key, receiver) => {
      if (key === "raw") {
        return raw;
      }

      return Reflect.get(target, key, receiver);
    },
  }) as unknown as TApiClient;
};

export type { TApiClient, TRawApi };
export { createTrpcApi };
