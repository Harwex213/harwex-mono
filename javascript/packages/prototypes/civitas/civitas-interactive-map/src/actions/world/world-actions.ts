import type { TStore } from "../../store/index";

// The countries come from `assets/countries.json` and never change after the load.
// `loadMap` writes them. The only world action left hides the repair notice.

function dismissCountriesNotice(store: TStore): void {
  if (store.world.notice.peek() === null) {
    return;
  }
  store.world.notice.value = null;
}

export { dismissCountriesNotice };
