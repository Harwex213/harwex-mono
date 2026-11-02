import type { TDb, TPickRow } from "./db.ts";
import { findTeam } from "./teams.ts";
import type { TTeam } from "./teams.ts";
import { computeVeto } from "./veto.ts";
import type { TAction, TFormat, TSide, TVeto } from "./veto.ts";

// What any viewer of a pick sees. Tokens never leave the server.
type TPickView = TVeto & {
  id: string;
  createdAt: string;
  format: TFormat;
  teamA: TTeam;
  teamB: TTeam;
  guestJoined: boolean;
  firstSide: TSide | null;
  actions: TAction[];
};

// A team removed from teams.json still renders under its id.
const teamOrStub = (id: string): TTeam => {
  return findTeam(id) ?? { id, name: id, players: [] };
};

const toView = (row: TPickRow, actions: TAction[]): TPickView => {
  return {
    ...computeVeto(row.format, row.firstSide, actions),
    id: row.id,
    createdAt: row.createdAt,
    format: row.format,
    teamA: teamOrStub(row.teamA),
    teamB: teamOrStub(row.teamB),
    guestJoined: row.guestToken !== null,
    firstSide: row.firstSide,
    actions,
  };
};

const loadView = (db: TDb, id: string) => {
  const row = db.getPick(id);
  if (!row) {
    return undefined;
  }
  return toView(row, db.getActions(id));
};

export type { TPickView };
export { loadView };
