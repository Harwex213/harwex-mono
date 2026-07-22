import { createStore } from "../store.js";
import { createInitialState } from "../state/app-state.js";

// Transitional shim while pages migrate to `{ el, destroy }` factories that
// receive { store } explicitly: STORE is the app's single source of truth;
// MODEL aliases its state object for legacy read paths (actions mutate the
// state in place, so the alias stays valid). Delete this file once every
// page takes { store }.

const STORE = createStore(createInitialState());
const MODEL = STORE.get();

export { STORE, MODEL };
