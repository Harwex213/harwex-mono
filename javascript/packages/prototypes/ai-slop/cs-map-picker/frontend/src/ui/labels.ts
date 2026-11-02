import type { TFormat, TPickView, TSide } from "../domain/types";

const FORMAT_LABEL: Record<TFormat, string> = {
  bo1: "BO1",
  bo3: "BO3 · финал",
};

const teamOf = (pick: TPickView, side: TSide) => {
  return side === "a" ? pick.teamA : pick.teamB;
};

const statusText = (pick: TPickView) => {
  if (pick.phase === "waiting") {
    return "Ждём соперника";
  }
  if (pick.phase === "veto") {
    return `Идут пики · шаг ${(pick.next?.step ?? 0) + 1} из 7`;
  }
  return "Завершены";
};

export { FORMAT_LABEL, teamOf, statusText };
