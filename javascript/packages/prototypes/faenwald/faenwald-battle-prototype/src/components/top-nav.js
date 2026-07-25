import { ROUTE_LINKS, ROUTES } from "../data/routing.js";

const NAV_ITEMS = [
  [ROUTES.BATTLE_CREATION, "Battle Creation"],
  [ROUTES.MODIFIERS_COLLECTIONS, "Modifiers"],
  [ROUTES.MAPS, "Maps"],
];

const isActive = (currentPath, route) => currentPath === route || currentPath.startsWith(`${route}/`);

/**
 * App-shell navigation, mounted once above <main> — pages don't render it.
 * Re-renders on store changes (the "Current Battle" item follows
 * activeBattle.phase) and on every resolved navigation (active-link state).
 *
 * @param {{ store: Store, router: Router }} deps
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
const createTopNav = ({ store, router }) => {
  const el = document.createElement("nav");
  el.className = "top-nav";
  el.innerHTML = `
    <a class="top-nav-brand" href="${ROUTE_LINKS.BATTLE_CREATION}">Faenwald Battle</a>
    <span class="top-nav-links" data-role="links"></span>
  `;
  const linksEl = el.querySelector("[data-role=links]");

  const render = () => {
    const currentPath = router.currentPath();
    const hasActiveBattle = store.get().activeBattle.phase !== null;
    const navItems = [
      hasActiveBattle ? [ROUTES.BATTLE, "Current Battle"] : null,
      ...NAV_ITEMS,
    ].filter(Boolean);

    linksEl.replaceChildren(...navItems.map(([route, label]) => {
      const link = document.createElement("a");
      link.className = "top-nav-link";
      link.href = `#${route}`;
      link.textContent = label;
      if (isActive(currentPath, route)) {
        link.setAttribute("aria-current", "page");
      }
      return link;
    }));
  };

  const unsubscribeStore = store.subscribe(render);
  const unsubscribeRouter = router.onChange(render);

  const destroy = () => {
    unsubscribeStore();
    unsubscribeRouter();
  };

  return { el, destroy };
};

export { createTopNav };
