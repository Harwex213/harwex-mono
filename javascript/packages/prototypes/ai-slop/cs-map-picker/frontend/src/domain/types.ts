// Mirrors the backend responses (backend/src/view.ts).
type TFormat = "bo1" | "bo3";
type TSide = "a" | "b";
type TActionKind = "ban" | "pick";

type TMap = {
  id: string;
  name: string;
};

type TTeam = {
  id: string;
  name: string;
  players: string[];
};

type TAction = {
  step: number;
  side: TSide;
  kind: TActionKind;
  map: string;
};

type TPickView = {
  id: string;
  createdAt: string;
  format: TFormat;
  teamA: TTeam;
  teamB: TTeam;
  guestJoined: boolean;
  firstSide: TSide | null;
  actions: TAction[];
  phase: "waiting" | "veto" | "done";
  next: { step: number; side: TSide; kind: TActionKind } | null;
  remaining: string[];
  decider: string | null;
  playOrder: string[];
};

type TMeta = {
  maps: TMap[];
  teams: TTeam[];
  formats: TFormat[];
};

// One pick this browser created or joined, kept in localStorage.
type TStoredPick = {
  id: string;
  token: string;
  side: TSide;
  savedAt: string;
};

type TRoute =
  | { name: "home" }
  | { name: "new" }
  | { name: "join" }
  | { name: "pick"; id: string };

export type { TFormat, TSide, TActionKind, TMap, TTeam, TAction, TPickView, TMeta, TStoredPick, TRoute };
