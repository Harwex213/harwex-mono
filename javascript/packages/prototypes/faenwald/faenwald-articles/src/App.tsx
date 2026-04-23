import { router } from "@/route.ts";
import { createElement } from "react";

import.meta.glob("./articles/*.tsx", { eager: true });

export const App = () => {
  const pathname = window.location.pathname;
  const component = router.routes[pathname];

  return createElement(component);
};
