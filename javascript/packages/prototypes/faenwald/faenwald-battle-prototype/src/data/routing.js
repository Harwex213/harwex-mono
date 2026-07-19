const ROUTES = {
  ROOT: "/",
  BATTLE_CREATION: "/battle-creation",
  BATTLE: "/battle",
  BATTLE_DISPOSITION: "/battle/units-disposition",
  BATTLE_ACTIVE: "/battle/active",
  BATTLE_FINISHED: "/battle/finished",
  MODIFIERS_COLLECTIONS: "/modifiers-collection",
  MODIFIERS: "/modifiers-collection/:collectionId",
  MAPS: "/maps",
  MAP_EDITOR: "/maps/:mapId",
};

const ROUTE_LINKS = Object.entries(ROUTES).reduce((acc, [name, route]) => {
  acc[name] = "#" + route;

  return acc;
}, {});

export { ROUTES, ROUTE_LINKS };
