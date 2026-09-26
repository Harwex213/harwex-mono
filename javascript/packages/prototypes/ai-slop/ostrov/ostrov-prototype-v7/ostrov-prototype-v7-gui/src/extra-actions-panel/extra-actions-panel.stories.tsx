import { useState } from "react";
import { ExtraActionsPanel } from "./extra-actions-panel";
import type { ExtraAction } from "./extra-actions-panel";
import type { WidgetStories } from "../story";
import type { CSSProperties, ReactElement, ReactNode } from "react";

// The tooltip floats above the strip and the tile clips what leaves it, so a
// story leaves room above and to the left of the widget.
const room: CSSProperties = {
  paddingTop: "190px",
  paddingLeft: "460px",
};

const Frame = ({ children }: { children: ReactNode }): ReactElement => {
  return <div style={room}>{children}</div>;
};

const demolish: ExtraAction = {
  id: "demolish",
  icon: "⛏️",
  title: "Снести здание",
  description: "Включает режим сноса: клик по гексу убирает с него здание.",
};

const scout: ExtraAction = {
  id: "scout",
  icon: "🛸",
  title: "Вызвать разведчика",
  description: "Открывает соседние гексы и показывает их биомы на один ход.",
};

const mockupActions: readonly ExtraAction[] = [demolish, scout];

const sixActions: readonly ExtraAction[] = [
  demolish,
  scout,
  {
    id: "road",
    icon: "🛤️",
    title: "Построить дорогу",
    description: "Соединяет два здания и ускоряет доставку ресурсов.",
  },
  {
    id: "market",
    icon: "🏪",
    title: "Открыть рынок",
    description: "Меняет лишние ресурсы на золото по курсу дня.",
  },
  {
    id: "ritual",
    icon: "🔮",
    title: "Провести ритуал",
    description: "Тратит ману и даёт острову один спокойный ход.",
  },
  {
    id: "storm",
    icon: "🌩️",
    title: "Вызвать грозу",
    description: "Гасит пожары на всех гексах, но пугает жителей.",
  },
];

const wordyActions: readonly ExtraAction[] = [
  {
    id: "resettle",
    icon: "🏕️",
    title: "Переселить жителей",
    description:
      "Переносит жителей с выбранного гекса на любой свободный гекс острова. " +
      "Переезд занимает три хода, всё это время здание не приносит дохода, " +
      "а жители едят вдвое больше обычного. Отменить переезд после начала " +
      "нельзя, так что выбирайте новый гекс заранее.",
  },
  scout,
];

// The story that shows `onSelect`: the selection lives here, never in the
// widget.
const SelectionStory = (): ReactElement => {
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const active = sixActions.find((action) => {
    return action.id === activeId;
  });

  return (
    <Frame>
      <ExtraActionsPanel
        actions={sixActions}
        activeId={activeId}
        onSelect={setActiveId}
      />
      <p style={{ color: "var(--ostrov-light)", fontFamily: "var(--ostrov-font)" }}>
        Выбрано: {active === undefined ? "ничего" : active.title}
      </p>
    </Frame>
  );
};

const stories: WidgetStories = {
  id: "extra-actions-panel",
  title: "ExtraActionsPanel",
  stories: [
    {
      id: "mockup",
      title: "Как в макете",
      note: "Две кнопки, снос выбран: у него золотая рамка, у второй — стальная.",
      render() {
        return (
          <Frame>
            <ExtraActionsPanel
              actions={mockupActions}
              activeId="demolish"
              onSelect={() => {}}
            />
          </Frame>
        );
      },
    },
    {
      id: "tooltip",
      title: "Подсказка",
      note: "Наведите курсор на кнопку или дойдите до неё табом: подсказка всплывает над полоской.",
      render() {
        return (
          <Frame>
            <ExtraActionsPanel
              actions={mockupActions}
              activeId="scout"
              onSelect={() => {}}
            />
          </Frame>
        );
      },
    },
    {
      id: "six",
      title: "Шесть действий",
      note: "Полоска растёт вниз и остаётся узкой.",
      render() {
        return (
          <Frame>
            <ExtraActionsPanel
              actions={sixActions}
              activeId="ritual"
              onSelect={() => {}}
            />
          </Frame>
        );
      },
    },
    {
      id: "long-description",
      title: "Длинное описание",
      note: "Описание переселения занимает четыре строки, ширина подсказки не растёт.",
      render() {
        return (
          <Frame>
            <ExtraActionsPanel
              actions={wordyActions}
              activeId="resettle"
              onSelect={() => {}}
            />
          </Frame>
        );
      },
    },
    {
      id: "no-active",
      title: "Ничего не выбрано",
      note: "Без `activeId` все рамки стальные.",
      render() {
        return (
          <Frame>
            <ExtraActionsPanel actions={mockupActions} onSelect={() => {}} />
          </Frame>
        );
      },
    },
    {
      id: "selection",
      title: "Выбор действия",
      note: "Клик по кнопке зовёт `onSelect`, выбор хранит сама история.",
      render() {
        return <SelectionStory />;
      },
    },
  ],
};

export { stories };
