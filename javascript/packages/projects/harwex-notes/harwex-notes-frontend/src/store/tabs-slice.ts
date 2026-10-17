import { signal } from "@preact/signals-react";

const createTabsState = () => ({
  openIds: signal<readonly string[]>([]),
  activeId: signal<string | null>(null),
  // Why the last link the user followed opened nothing (EX-9). Shown near the tab bar.
  linkError: signal<string | null>(null),
});

type TTabsSlice = ReturnType<typeof createTabsState>;

export type { TTabsSlice };
export { createTabsState };
