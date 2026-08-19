import type { LiveTable, Provider, TableId } from "../model/types";

// Layer 5: api. Intentionally unimplemented — it only fixes the shape of the
// I/O the app will eventually do, so the layers above can already name it.
//
// When it lands, nothing below the registry changes: the registry stays the
// composition root, it awaits an api call and hands the payload to a plain
// domain function, which is the only thing allowed to mutate the store.

type LobbySnapshot = {
  readonly providers: readonly Provider[];
  readonly tables: readonly LiveTable[];
};

type Api = {
  readonly fetchLobby: () => Promise<LobbySnapshot>;
  readonly takeSeat: (tableId: TableId) => Promise<void>;
  readonly releaseSeat: (tableId: TableId) => Promise<void>;
};

const NOT_IMPLEMENTED = "api layer is not implemented yet";

function createApi(): Api {
  return {
    fetchLobby: () => Promise.reject(new Error(NOT_IMPLEMENTED)),
    takeSeat: (_tableId: TableId) => Promise.reject(new Error(NOT_IMPLEMENTED)),
    releaseSeat: (_tableId: TableId) => Promise.reject(new Error(NOT_IMPLEMENTED)),
  };
}

export { createApi };
export type { Api, LobbySnapshot };
