import { batch } from "@preact/signals-react";
import type { TStore } from "../store/store";
import { createId } from "./thought";
import type { TCategoryId, TThought } from "./thought";

const addThoughtAction = (store: TStore, text: string) => {
  const trimmed = text.trim();
  if (trimmed === "") {
    return;
  }

  const now = Date.now();
  const thought: TThought = {
    id: createId(),
    text: trimmed,
    category: store.activeCategory.peek(),
    createdAt: now,
    updatedAt: now,
  };
  store.thoughts.value = [...store.thoughts.peek(), thought];
};

const deleteThoughtAction = (store: TStore, id: string) => {
  const thoughts = store.thoughts.peek();
  const index = thoughts.findIndex((thought) => thought.id === id);
  if (index === -1) {
    return;
  }

  batch(() => {
    store.lastDeleted.value = { thought: thoughts[index]!, index };
    store.thoughts.value = thoughts.filter((thought) => thought.id !== id);
  });
};

// An emptied thought is deleted, and the undo toast can bring it back.
const updateThoughtTextAction = (store: TStore, id: string, text: string) => {
  const trimmed = text.trim();
  if (trimmed === "") {
    deleteThoughtAction(store, id);
    return;
  }

  store.thoughts.value = store.thoughts.peek().map((thought) => {
    if (thought.id !== id || thought.text === trimmed) {
      return thought;
    }

    return { ...thought, text: trimmed, updatedAt: Date.now() };
  });
};

// The thought goes to the end of the target category.
const moveThoughtAction = (store: TStore, id: string, category: TCategoryId) => {
  const thoughts = store.thoughts.peek();
  const thought = thoughts.find((item) => item.id === id);
  if (!thought || thought.category === category) {
    return;
  }

  batch(() => {
    store.thoughts.value = [
      ...thoughts.filter((item) => item.id !== id),
      { ...thought, category, updatedAt: Date.now() },
    ];
    store.pulse.value = { category, at: Date.now() };
  });
};

// toIndex is a position inside the category of the thought.
const reorderThoughtAction = (store: TStore, id: string, toIndex: number) => {
  const thoughts = store.thoughts.peek();
  const thought = thoughts.find((item) => item.id === id);
  if (!thought) {
    return;
  }

  const sameCategory = thoughts.filter((item) => item.category === thought.category);
  const fromIndex = sameCategory.indexOf(thought);
  if (fromIndex === toIndex) {
    return;
  }

  sameCategory.splice(fromIndex, 1);
  sameCategory.splice(toIndex, 0, thought);

  // Other categories keep their slots; this category fills its own slots in the new order.
  let next = 0;
  store.thoughts.value = thoughts.map((item) => {
    if (item.category !== thought.category) {
      return item;
    }
    const replacement = sameCategory[next]!;
    next += 1;

    return replacement;
  });
};

const restoreDeletedAction = (store: TStore) => {
  const deleted = store.lastDeleted.peek();
  if (!deleted) {
    return;
  }

  const thoughts = [...store.thoughts.peek()];
  thoughts.splice(Math.min(deleted.index, thoughts.length), 0, deleted.thought);
  batch(() => {
    store.thoughts.value = thoughts;
    store.activeCategory.value = deleted.thought.category;
    store.lastDeleted.value = null;
  });
};

const dismissDeletedAction = (store: TStore) => {
  store.lastDeleted.value = null;
};

const setActiveCategoryAction = (store: TStore, category: TCategoryId) => {
  store.activeCategory.value = category;
};

export {
  addThoughtAction,
  deleteThoughtAction,
  dismissDeletedAction,
  moveThoughtAction,
  reorderThoughtAction,
  restoreDeletedAction,
  setActiveCategoryAction,
  updateThoughtTextAction,
};
