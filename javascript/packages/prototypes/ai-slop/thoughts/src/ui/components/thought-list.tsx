import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import type { FC } from "react";
import type { TAppRegistry } from "../../domain/registry";
import { getCategory } from "../../domain/thought";
import { useStore } from "../../store/store";
import { ListGestures } from "../gestures/list-gestures";
import { ThoughtRow } from "./thought-row";

type TThoughtListProps = {
  registry: TAppRegistry;
};

const ThoughtList: FC<TThoughtListProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const listRef = useRef<HTMLDivElement>(null);
  const categoryId = store.activeCategory.value;
  const category = getCategory(categoryId);
  const thoughts = store.thoughts.value.filter((thought) => thought.category === categoryId);

  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }

    const gestures = new ListGestures(list, store, registry);

    return () => {
      gestures.destroy();
    };
  }, [store, registry]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [categoryId]);

  return (
    <div ref={listRef} className="list" data-category={categoryId}>
      <h1 className="list-title">
        <span className="list-emoji" aria-hidden="true">{category.emoji}</span>
        {category.title}
      </h1>
      {thoughts.length === 0 ? (
        <div className="list-empty">{category.empty}</div>
      ) : (
        thoughts.map((thought) => <ThoughtRow key={thought.id} thought={thought} />)
      )}
    </div>
  );
};

export { ThoughtList };
