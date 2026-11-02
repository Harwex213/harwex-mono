import type { TStore } from "../store/store";
import { api } from "./api";
import type { TSession } from "./api";
import { parseRoute, routeHash } from "./router";
import { writeStoredPicks } from "./storage";
import type { TRoute } from "./types";

const closePick = (store: TStore) => {
  store.pick.connection.source?.close();
  store.pick.connection.source = null;
  store.pick.view.value = null;
  store.pick.loadError.value = null;
  store.pick.actionError.value = null;
  store.pick.selectedMap.value = null;
};

// Subscribes to the pick's live stream. The stream sends the full state first, then every change.
const openPick = (store: TStore, id: string) => {
  closePick(store);
  const source = new EventSource(api.eventsUrl(id));
  store.pick.connection.source = source;

  source.onmessage = (event) => {
    store.pick.view.value = JSON.parse(event.data);
    store.pick.loadError.value = null;
  };
  // EventSource reconnects by itself. A missing pick answers 404, which ends the stream for good.
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) {
      api.getPick(id).catch((error: Error) => {
        store.pick.loadError.value = error.message;
      });
    }
  };
};

const refreshMyPicks = async (store: TStore) => {
  const ids = store.storedPicks.peek().map((stored) => stored.id);
  if (ids.length === 0) {
    store.myPickViews.value = [];
    return;
  }
  try {
    store.myPickViews.value = await api.listPicks(ids);
  } catch {
    // the list keeps its last state
  }
};

const applyRoute = (store: TStore, route: TRoute) => {
  store.route.value = route;
  store.formError.value = null;
  if (route.name === "pick") {
    openPick(store, route.id);
  } else {
    closePick(store);
  }
  if (route.name === "home") {
    void refreshMyPicks(store);
  }
};

const startApp = (store: TStore) => {
  applyRoute(store, parseRoute(location.hash));
  window.addEventListener("hashchange", () => {
    applyRoute(store, parseRoute(location.hash));
  });

  api.meta().then(
    (meta) => {
      store.meta.value = meta;
    },
    (error: Error) => {
      store.metaError.value = error.message;
    },
  );
};

const navigate = (store: TStore, route: TRoute) => {
  const hash = routeHash(route);
  if (location.hash === hash) {
    applyRoute(store, route);
  } else {
    location.hash = hash;
  }
};

const rememberSession = (store: TStore, session: TSession) => {
  const others = store.storedPicks.peek().filter((stored) => stored.id !== session.id);
  const next = [{ ...session, savedAt: new Date().toISOString() }, ...others];
  store.storedPicks.value = next;
  writeStoredPicks(next);
};

const forgetPick = (store: TStore, id: string) => {
  const next = store.storedPicks.peek().filter((stored) => stored.id !== id);
  store.storedPicks.value = next;
  store.myPickViews.value = store.myPickViews.peek().filter((view) => view.id !== id);
  writeStoredPicks(next);
};

const createPick = async (store: TStore, format: string, teamA: string, teamB: string) => {
  store.formBusy.value = true;
  store.formError.value = null;
  try {
    const session = await api.createPick(format, teamA, teamB);
    rememberSession(store, session);
    navigate(store, { name: "pick", id: session.id });
  } catch (error) {
    store.formError.value = (error as Error).message;
  } finally {
    store.formBusy.value = false;
  }
};

// Takes the opponent seat. A taken seat leaves the visitor on the pick as a spectator.
const joinPick = async (store: TStore, id: string) => {
  if (store.storedPicks.peek().some((stored) => stored.id === id)) {
    navigate(store, { name: "pick", id });
    return;
  }

  store.formBusy.value = true;
  store.formError.value = null;
  try {
    rememberSession(store, await api.joinPick(id));
    navigate(store, { name: "pick", id });
  } catch (error) {
    store.formError.value = (error as Error).message;
  } finally {
    store.formBusy.value = false;
  }
};

export { startApp, navigate, createPick, joinPick, forgetPick, refreshMyPicks };
