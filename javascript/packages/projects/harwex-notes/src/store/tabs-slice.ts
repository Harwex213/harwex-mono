import { signal } from "@preact/signals-react";

const createTabsState = () => ({
  openIds: signal<readonly string[]>([]),
  activeId: signal<string | null>(null),
});

type TTabsSlice = ReturnType<typeof createTabsState>;

export type { TTabsSlice };
export { createTabsState };
