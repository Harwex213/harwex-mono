const ROUTES = {
  ROOT: "/",
  GAME: "/game",
  BATTLE: "/battle",
  MODIFIERS_COLLECTIONS: "/modifiers-collection",
  MODIFIERS: "/modifiers-collection/:collectionId",
};

const ROUTE_LINKS = Object.entries(ROUTES).reduce((acc, [name, route]) => {
  acc[name] = "#" + route;

  return acc;
}, {});

export { ROUTES, ROUTE_LINKS };
