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

type StatId = "hp" | "attack" | "morale";

type UnitStats = Record<StatId, number>;

type ModifierEntry = {
  id: number;
  stat: StatId;
  value: number;
};

type Modifier = {
  id: string;
  name: string;
  description: string;
  flat: ModifierEntry[];
  percent: ModifierEntry[];
};
