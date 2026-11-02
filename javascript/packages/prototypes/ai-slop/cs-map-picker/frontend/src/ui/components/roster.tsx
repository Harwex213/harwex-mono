import type { FC } from "react";
import type { TTeam } from "../../domain/types";

type TRosterProps = {
  team: TTeam;
};

const Roster: FC<TRosterProps> = ({ team }) => {
  if (team.players.length === 0) {
    return null;
  }

  return (
    <ul className="roster">
      {team.players.map((player) => (
        <li key={player}>{player}</li>
      ))}
    </ul>
  );
};

export { Roster };
