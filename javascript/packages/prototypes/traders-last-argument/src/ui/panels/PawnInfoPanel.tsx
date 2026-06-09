import { useEffect, useState } from "react";
import type { Pawn } from "@/core/types";
import classes from "./PawnInfoPanel.module.css";

interface PawnInfoPanelProps {
  pawnId: number | null;
  getPawn: (id: number) => Pawn | undefined;
}

const PawnInfoPanel = ({ pawnId, getPawn }: PawnInfoPanelProps) => {
  const [, setTick] = useState(0);

  // Periodically re-read pawn data from ref so panel stays up to date
  useEffect(() => {
    if (pawnId === null) return;
    const id = setInterval(() => setTick((t) => t + 1), 200);
    return () => clearInterval(id);
  }, [pawnId]);

  if (pawnId === null) return null;

  const pawn = getPawn(pawnId);
  if (!pawn) return null;

  const healthPercent = (pawn.health / pawn.maxHealth) * 100;

  return (
    <div className={classes.panel}>
      <div className={classes.name}>{pawn.name}</div>
      <div className={classes.stat}>
        <span className={classes.label}>HP</span>
        <div className={classes.healthBar}>
          <div
            className={classes.healthFill}
            style={{ width: `${healthPercent}%` }}
          />
        </div>
        <span className={classes.healthText}>
          {pawn.health} / {pawn.maxHealth}
        </span>
      </div>
    </div>
  );
};

export { PawnInfoPanel };
