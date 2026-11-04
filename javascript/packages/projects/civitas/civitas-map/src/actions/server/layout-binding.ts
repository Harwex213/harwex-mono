import { batch } from "@preact/signals-react";
import {
  bindLayout,
  bindNotice,
} from "../../domain/index";
import type { TStore } from "../../store/index";
import { replaceCountries } from "../countries/country-actions";

// Binds the registry to what the backend stores for the open map: names by hex,
// and the stored countries over the registry's ids. Runs after anything that
// replaces the registry. Returns the sentence for the notice, or "" when the
// map is not from the backend.
function applyServerLayout(store: TStore): string {
  const layout = store.server.layout.value;

  if (!store.server.map.value || !layout) {
    return "";
  }

  const bound = bindLayout(store.provinces.list.value, layout);

  batch(() => {
    store.provinces.list.value = bound.provinces;

    if (bound.countries) {
      replaceCountries(store, bound.countries);
    }
  });

  return bindNotice(bound);
}

export { applyServerLayout };
