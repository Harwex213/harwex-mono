import type { TRoute } from "./types";

export type TAppRegistry = {
  navigate: (route: TRoute) => void;
  createPick: (format: string, teamA: string, teamB: string) => Promise<void>;
  joinPick: (id: string) => Promise<void>;
  forgetPick: (id: string) => void;
  selectMap: (mapId: string | null) => void;
  confirmMap: () => Promise<void>;
};
