type TMap = {
  id: string;
  name: string;
};

const MAP_POOL: TMap[] = [
  { id: "dust2", name: "Dust II" },
  { id: "mirage", name: "Mirage" },
  { id: "inferno", name: "Inferno" },
  { id: "cache", name: "Cache" },
  { id: "overpass", name: "Overpass" },
  { id: "train", name: "Train" },
  { id: "office", name: "Office" },
  { id: "nuke", name: "Nuke" },
];

const findMap = (id: string) => {
  return MAP_POOL.find((map) => map.id === id);
};

export type { TMap };
export { MAP_POOL, findMap };
