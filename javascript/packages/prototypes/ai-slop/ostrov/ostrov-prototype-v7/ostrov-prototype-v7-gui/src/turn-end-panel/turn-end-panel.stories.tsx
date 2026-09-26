import { TurnEndPanel } from "./turn-end-panel";
import type { TurnPhase } from "./turn-end-panel";
import type { WidgetStories } from "../story";

const phases: readonly TurnPhase[] = [
  { id: "build", icon: "⚒️", label: "Строительство" },
  { id: "gather", icon: "🍗", label: "Сбор" },
  { id: "scout", icon: "🔭", label: "Разведка" },
  { id: "war", icon: "⚔️", label: "Война" },
];

const noop = (): void => {};

const stories: WidgetStories = {
  id: "turn-end-panel",
  title: "TurnEndPanel",
  stories: [
    {
      id: "mockup",
      title: "Как в макете",
      note: "Горит верхний сектор, подпись под кругом повторяет фазу.",
      render() {
        return (
          <TurnEndPanel
            phases={phases}
            activePhaseId="build"
            endLabel="Готов"
            onEnd={noop}
          />
        );
      },
    },
  ],
};

export { stories };
