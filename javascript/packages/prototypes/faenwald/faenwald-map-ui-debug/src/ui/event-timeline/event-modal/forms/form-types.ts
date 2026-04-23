import type { TGameContext } from "@hw/faenwald-core";

export type TFormProps = {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  gameContext: TGameContext;
};

export const getArmyOptions = (gameContext: TGameContext) => {
  const state = gameContext.turns.length > 0 ? undefined : undefined;
  // Derive armies from all ArmyCorrection events across turns
  const armies: { value: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const turn of gameContext.turns) {
    for (const phase of turn.phases) {
      for (const ev of phase) {
        if (ev.type === "war" && ev.event.type === "TWarEvent_ArmyCorrection") {
          const id = ev.event.armyId ?? (ev.event as Record<string, unknown>).armyId as string;
          const name = (ev.event as Record<string, unknown>).name as string ?? id;
          if (id && !seen.has(id)) {
            seen.add(id);
            armies.push({ value: id, label: name });
          }
        }
      }
    }
  }
  void state;
  return armies;
};

export const getProvinceOptions = (gameContext: TGameContext) =>
  Object.entries(gameContext.provincesRaw).map(([id, p]) => ({
    value: id,
    label: p.provinceName,
  }));

export const getHouseOptions = (gameContext: TGameContext) => {
  const houses: { value: string; label: string }[] = [];
  // Scan for houses in events — simplified: just return empty for now
  // Houses would need to be derived from game state
  void gameContext;
  return houses;
};
