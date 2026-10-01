import { signal } from "@preact/signals-react";

type Side = 0 | 1;

type SetScore = [number, number];

type Team = {
  name: string;
  tag: string;
};

type MatchState = {
  teams: [Team, Team];
  // Finished sets plus the set in progress (last entry).
  sets: SetScore[];
  points: [number, number];
  server: Side;
  tiebreak: boolean;
  winner: Side | null;
  // Bumped on every point so the UI can replay the "point won" flash.
  rally: number;
  lastPointBy: Side | null;
};

const SETS_TO_WIN = 3;
const POINT_LABELS = ["0", "15", "30", "40"];

function initialState(): MatchState {
  return {
    teams: [
      { name: "Barry M / Hanatani N", tag: "W" },
      { name: "Kitahara Y / Wan I W", tag: "W" },
    ],
    sets: [
      [6, 3],
      [6, 1],
      [4, 6],
      [3, 4],
    ],
    points: [1, 2],
    server: 0,
    tiebreak: false,
    winner: null,
    rally: 0,
    lastPointBy: null,
  };
}

const match = signal<MatchState>(initialState());

function other(side: Side): Side {
  return side === 0 ? 1 : 0;
}

function isSetWon(score: SetScore, side: Side): boolean {
  const mine = score[side];
  const theirs = score[other(side)];
  if (mine === 7) {
    return true;
  }
  return mine === 6 && theirs <= 4;
}

function setsWon(sets: SetScore[], side: Side): number {
  return sets.filter((score) => isSetWon(score, side)).length;
}

function currentSet(state: MatchState): SetScore {
  return state.sets.at(-1) ?? [0, 0];
}

function winGame(state: MatchState, side: Side): MatchState {
  const last = currentSet(state);
  const current: SetScore = [last[0], last[1]];
  current[side] += 1;
  const sets = [...state.sets.slice(0, -1), current];
  const next: MatchState = {
    ...state,
    sets,
    points: [0, 0],
    server: other(state.server),
    tiebreak: false,
  };

  if (isSetWon(current, side)) {
    if (setsWon(sets, side) === SETS_TO_WIN) {
      return { ...next, winner: side };
    }
    return { ...next, sets: [...sets, [0, 0]] };
  }

  next.tiebreak = current[0] === 6 && current[1] === 6;
  return next;
}

function scorePoint(side: Side): void {
  const state = match.value;
  if (state.winner !== null) {
    return;
  }

  const points: [number, number] = [state.points[0], state.points[1]];
  points[side] += 1;
  const mine = points[side];
  const theirs = points[other(side)];
  const base: MatchState = { ...state, rally: state.rally + 1, lastPointBy: side };

  if (state.tiebreak) {
    if (mine >= 7 && mine - theirs >= 2) {
      match.value = winGame(base, side);
      return;
    }
    // In a tiebreak the serve changes after the first point, then every two points.
    const played = points[0] + points[1];
    const server = played % 2 === 1 ? other(state.server) : state.server;
    match.value = { ...base, points, server };
    return;
  }

  if (mine >= 4 && mine - theirs >= 2) {
    match.value = winGame(base, side);
    return;
  }
  // Deuce after advantage: drop both back to 40-40.
  if (mine === 4 && theirs === 4) {
    match.value = { ...base, points: [3, 3] };
    return;
  }
  match.value = { ...base, points };
}

function pointLabel(state: MatchState, side: Side): string {
  const mine = state.points[side];
  if (state.tiebreak) {
    return String(mine);
  }
  const theirs = state.points[other(side)];
  if (mine >= 3 && theirs >= 3) {
    return mine > theirs ? "AD" : "40";
  }
  return POINT_LABELS[mine] ?? "0";
}

function resetMatch(): void {
  match.value = initialState();
}

export { isSetWon, match, pointLabel, resetMatch, scorePoint };
export type { MatchState, SetScore, Side, Team };
