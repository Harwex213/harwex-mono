import { TurnPanel } from "./turn-panel";
import type { WidgetStories } from "../story";

const stories: WidgetStories = {
  id: "turn-panel",
  title: "TurnPanel",
  stories: [
    {
      id: "mockup",
      title: "Первый ход",
      note: "Макет: золотой номер хода над приглушённым названием фазы.",
      render() {
        return <TurnPanel turn={1} phase="Фаза строительства" />;
      },
    },
    {
      id: "wide-turn",
      title: "Трёхзначный ход",
      note: "Три цифры: первая строка остаётся одной строкой.",
      render() {
        return <TurnPanel turn={248} phase="Фаза строительства" />;
      },
    },
    {
      id: "long-phase",
      title: "Длинная фаза",
      note: "Карточка растёт вслед за названием фазы, номер остаётся по центру.",
      render() {
        return <TurnPanel turn={12} phase="Фаза разведки и переселения" />;
      },
    },
  ],
};

export { stories };
