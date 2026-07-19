import { ROUTE_LINKS, ROUTES } from "../data/routing.js";

const STYLE = `
  <style>
    .tn {
      display: flex;
      align-items: center;
      gap: var(--space-6);
      padding: var(--space-6) var(--space-8);
      border-bottom: 1px solid var(--border-default);
      font-family: var(--font-body);
    }

    .tn .brand {
      margin-right: auto;
      font-family: var(--font-display);
      font-size: var(--font-size-xl);
      color: var(--text-accent);
      text-decoration: none;
    }

    .tn .link {
      padding: var(--space-4) var(--space-6);
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      text-decoration: none;
    }

    .tn .link:hover {
      color: var(--text-primary);
      background: var(--bg-control-subtle-hover);
    }

    .tn .link[aria-current="page"] {
      color: var(--text-accent);
      background: var(--bg-accent);
    }
  </style>
`;

const NAV_ITEMS = [
  [ROUTES.BATTLE_CREATION, "Battle Creation"],
  [ROUTES.MODIFIERS_COLLECTIONS, "Modifiers"],
  [ROUTES.MAPS, "Maps"],
];

const topNavHtml = (router) => {
  const path = router.currentPath();
  // prefix match keeps a section link active on its child routes,
  // e.g. Modifiers stays lit on /modifiers-collection/:collectionId
  const isActive = (route) => path === route || path.startsWith(`${route}/`);

  const links = NAV_ITEMS.map(
    ([route, label]) => `
      <a class="link" href="#${route}" ${isActive(route) ? 'aria-current="page"' : ""}>${label}</a>`,
  ).join("");

  return `
    ${STYLE}
    <nav class="tn">
      <a class="brand" href="${ROUTE_LINKS.BATTLE_CREATION}">Faenwald Battle</a>
      ${links}
    </nav>
  `;
};

export { topNavHtml };
