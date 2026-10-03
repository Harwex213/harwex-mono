import type { TFaction, TFactionKind } from "./state";

const PLAYERS_FACTION_ID = "union";
const NATIVES_FACTION_ID = "natives";
const HITECH_FACTION_ID = "nexus";

type TFactionSeed = {
  id: string;
  name: string;
  color: string;
  kind: TFactionKind;
  motto: string;
};

/**
 * The roster. The players' union is the only faction with two owners. The natives
 * hold the camps, the Nexus is the hi-tech island-city the game is won by taking,
 * and the four rivals are ordinary kingdoms that grow while the players do.
 */
const FACTION_SEEDS: readonly TFactionSeed[] = [
  { id: PLAYERS_FACTION_ID, name: "Союз двух племён", color: "#3fb5a3", kind: "players", motto: "Мы поднимемся из глины" },
  { id: NATIVES_FACTION_ID, name: "Туземцы", color: "#b9773a", kind: "natives", motto: "Земля помнит своих" },
  { id: HITECH_FACTION_ID, name: "Цитадель Нексус", color: "#c94fd8", kind: "hitech", motto: "Мы уже были там, куда вы идёте" },
  { id: "amber", name: "Янтарное Ханство", color: "#d8a83a", kind: "rival", motto: "Дань или пепел" },
  { id: "crimson", name: "Багровая Лига", color: "#c8443f", kind: "rival", motto: "Кровь дороже золота" },
  { id: "ivory", name: "Орден Белой Соли", color: "#d9d4c5", kind: "rival", motto: "Чистота и порядок" },
  { id: "indigo", name: "Дом Глубин", color: "#5a6fd6", kind: "rival", motto: "Море не выдаёт" },
];

const createFactions = (): TFaction[] => {
  return FACTION_SEEDS.map((seed) => ({
    ...seed,
    homeIslandId: null,
    discovered: seed.kind === "players" || seed.kind === "natives",
    alive: true,
  }));
};

/** Display name of a faction, hidden while the players have not met it. */
const factionLabel = (faction: TFaction, index: number) => {
  if (faction.discovered) {
    return faction.name;
  }

  return `Неизвестная фракция ${index}`;
};

export { FACTION_SEEDS, HITECH_FACTION_ID, NATIVES_FACTION_ID, PLAYERS_FACTION_ID, createFactions, factionLabel };
