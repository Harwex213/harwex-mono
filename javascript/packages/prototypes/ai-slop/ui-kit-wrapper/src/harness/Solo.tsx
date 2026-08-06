import { UiProvider } from "@ui";
import { App } from "../app/App";

/**
 * What a real app's root looks like: one provider, no switcher, no second
 * adapter imported anywhere.
 *
 * `HARNESS=off yarn build` points the "@shell" alias here instead of at
 * `Harness`. Only the kit behind "@kit" is reachable from this entry, so only
 * that kit is bundled — the difference in `dist/` is how you check that the
 * abstraction did not quietly ship both.
 */
function Solo() {
  return (
    <UiProvider>
      <App />
    </UiProvider>
  );
}

export { Solo as Shell };
