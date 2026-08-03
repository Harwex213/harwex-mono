import type { ComponentType } from "react";
import { ActiveBattlePage } from "./active-battle/ActiveBattlePage";
import { HexGridPage } from "./hex-grid/HexGridPage";
import { UnitsDispositionPage } from "./units-disposition/UnitsDispositionPage";

type Page = {
  id: string;
  title: string;
  Component: ComponentType;
};

// One entry per page. The first one is the default route.
const PAGES: Page[] = [
  { id: "hex-grid", title: "Hex grid", Component: HexGridPage },
  { id: "units-disposition", title: "Units disposition", Component: UnitsDispositionPage },
  { id: "active-battle", title: "Active battle", Component: ActiveBattlePage },
];

function pageFor(id: string): Page {
  return PAGES.find((page) => page.id === id) ?? PAGES[0];
}

export { PAGES, pageFor };
export type { Page };
