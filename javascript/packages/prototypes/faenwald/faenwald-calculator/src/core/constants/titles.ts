type TTitle = "baron" | "viscount" | "count" | "duke" | "king" | "emperor";

const TITLE_DOMAIN_LIMIT: Record<TTitle, number> = {
  baron: 1,
  viscount: 2,
  count: 3,
  duke: 4,
  king: 5,
  emperor: 7,
};

export { TITLE_DOMAIN_LIMIT };
export type { TTitle };
