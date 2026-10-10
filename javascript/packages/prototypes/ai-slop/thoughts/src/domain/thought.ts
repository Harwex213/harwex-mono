const CATEGORIES = [
  { id: "goals", emoji: "🎯", title: "Рабочая", empty: "" },
  { id: "learn", emoji: "📖", title: "Контекст", empty: "" },
  { id: "dreams", emoji: "🌙", title: "Завтра", empty: "" },
] as const;

type TCategory = (typeof CATEGORIES)[number];

type TCategoryId = TCategory["id"];

type TThought = {
  id: string;
  text: string;
  category: TCategoryId;
  createdAt: number;
  updatedAt: number;
};

const isCategoryId = (value: unknown): value is TCategoryId => {
  return CATEGORIES.some((category) => category.id === value);
};

const getCategory = (id: TCategoryId) => {
  return CATEGORIES.find((category) => category.id === id)!;
};

// crypto.randomUUID exists only in secure contexts, and a phone opens the dev server over plain http.
const createId = () => {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export type { TCategory, TCategoryId, TThought };
export { CATEGORIES, createId, getCategory, isCategoryId };
