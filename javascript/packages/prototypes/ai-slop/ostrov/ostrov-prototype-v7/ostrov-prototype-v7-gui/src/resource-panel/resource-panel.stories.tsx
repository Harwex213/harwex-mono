import { ResourcePanel } from "./resource-panel";
import type { ResourceItem } from "./resource-panel";
import type { WidgetStories } from "../story";

const fullSet: readonly ResourceItem[] = [
  { id: "food", icon: "🍗", value: 10, label: "Еда" },
  { id: "stone", icon: "🪨", value: 12, label: "Камень" },
  { id: "wood", icon: "🪵", value: 12, label: "Дерево" },
  { id: "people", icon: "🧍", value: 6, label: "Население" },
  { id: "hammers", icon: "⚒️", value: 6, label: "Молотки" },
  { id: "science", icon: "📖", value: 0, label: "Наука" },
  { id: "scouting", icon: "🔭", value: 0, label: "Разведка" },
  { id: "mana", icon: "💠", value: 0, label: "Мана" },
  { id: "toxicity", icon: "☣️", value: 0, label: "Токсичность", tone: "positive" },
  { id: "madmen", icon: "🤖", value: 0, label: "Сумасшедшие", tone: "positive" },
];

const stories: WidgetStories = {
  id: "resource-panel",
  title: "ResourcePanel",
  stories: [
    {
      id: "full",
      title: "Полный набор",
      render() {
        return <ResourcePanel items={fullSet} />;
      },
    },
  ],
};

export { stories };
