const BATTLE_PHASE = {
  DISPOSITION: "disposition",
  ACTIVE: "active",
  FINISHED: "finished",
};

class ActiveBattle {
  #nextUnitId = 0;

  constructor() {
    this.phase = null;
    this.mapId = null;
    this.units = [];
    this.round = 0;
    this.activeGroup = null;
    this.log = [];
    this.winner = null;
  }

  startBattleDisposition(attackerUnits,) {
    if (this.phase !== null) {
      return;
    }

    this.phase = BATTLE_PHASE.DISPOSITION;
  }
}