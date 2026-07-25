/**
 * Battle-end losses per doc §1.5 and the binding ruling in 00-overview.md:24.
 * Every unit is classified by flag: destroyed → 100% of maxHp lost, half of
 * maxHp captured by the enemy; everyone else (survivors + routed, on- or
 * off-field) → 50% of HP lost. Rounded arithmetically (Math.round, doc §1.6).
 * @param {ActiveBattleUnit[]} units
 * @returns {{ attacker: SideLosses, defender: SideLosses }}
 */
const computeLosses = (units) => {
  const rows = units.map(lossRow);

  return {
    attacker: sideLosses(rows, "attacker"),
    defender: sideLosses(rows, "defender"),
  };
};

/**
 * @param {ActiveBattleUnit} unit
 * @returns {UnitLossRow}
 */
const lossRow = (unit) => {
  const status = unit.destroyed ? "destroyed" : unit.routed ? "routed" : "survivor";
  const hpLost = Math.max(0, unit.maxHp - unit.hp);
  const casualties = unit.destroyed ? unit.maxHp : Math.round(0.5 * hpLost);
  const prisoners = unit.destroyed ? Math.round(0.5 * unit.maxHp) : 0;

  return {
    unitId: unit.id,
    name: unit.name,
    side: unit.side,
    type: unit.type,
    status,
    maxHp: unit.maxHp,
    hp: Math.max(0, unit.hp),
    morale: Math.max(0, unit.morale),
    hpLost,
    casualties,
    prisoners,
  };
};

/**
 * @param {UnitLossRow[]} rows
 * @param {BattleConfigSide} side
 * @returns {SideLosses}
 */
const sideLosses = (rows, side) => {
  const sideRows = rows.filter((row) => row.side === side);
  const enemyRows = rows.filter((row) => row.side !== side);

  const survivors = sideRows.filter((row) => row.status === "survivor");
  const routed = sideRows.filter((row) => row.status === "routed");
  const destroyed = sideRows.filter((row) => row.status === "destroyed");

  const casualties = sideRows.reduce((sum, row) => sum + row.casualties, 0);
  const prisonersTaken = enemyRows
    .filter((row) => row.status === "destroyed")
    .reduce((sum, row) => sum + row.prisoners, 0);

  return { survivors, routed, destroyed, casualties, prisonersTaken };
};

export { computeLosses };
