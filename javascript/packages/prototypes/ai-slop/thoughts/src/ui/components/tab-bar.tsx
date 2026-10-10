import { useSignals } from "@preact/signals-react/runtime";
import type { FC } from "react";
import type { TSetActiveCategoryAction } from "../../domain/registry";
import { CATEGORIES } from "../../domain/thought";
import { useStore } from "../../store/store";

type TTabBarRegistrySlice = {
  setActiveCategoryAction: TSetActiveCategoryAction;
};

type TTabBarProps = {
  registry: TTabBarRegistrySlice;
};

const TabBar: FC<TTabBarProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const active = store.activeCategory.value;
  const thoughts = store.thoughts.value;
  const pulse = store.pulse.value;

  return (
    <nav className="tab-bar" role="tablist">
      {CATEGORIES.map((category) => {
        const count = thoughts.filter((thought) => thought.category === category.id).length;
        const isPulsing = pulse?.category === category.id;

        return (
          <button
            key={category.id}
            type="button"
            role="tab"
            className="tab"
            data-category={category.id}
            aria-selected={active === category.id}
            aria-label={`${category.title}: ${count}`}
            onClick={() => {
              registry.setActiveCategoryAction(category.id);
            }}
          >
            <span className="tab-emoji" aria-hidden="true">{category.emoji}</span>
            <span
              key={isPulsing ? pulse.at : "idle"}
              className="tab-count"
              data-pulse={isPulsing ? "true" : "false"}
            >
              {count}
            </span>
          </button>
        );
      })}
    </nav>
  );
};

export { TabBar };
