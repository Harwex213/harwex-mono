type BattleConfigUnitModifier = {
  collectionId: string;
  modifierId: string;
};

type BattleConfigSide = "attacker" | "defender";

type BattleConfigUnit = {
  id: number;
  typeId: string | null;
  modifiers: BattleConfigUnitModifier[];
};

type BattleConfig = {
  mapId: string | null;
  attacker: BattleConfigUnit[];
  defender: BattleConfigUnit[];
};
