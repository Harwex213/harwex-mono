type StudioToastLevel = "info" | "good" | "bad";

type StudioToastInput = {
  level?: StudioToastLevel;
  text: string;
  detail?: string;
};

type StudioToastItem = {
  id: number;
  level: StudioToastLevel;
  text: string;
  detail?: string;
};

/**
 * The studio kit's notification store: a module-level array, a subscribe
 * function, and a timer. No React provider, no hook, callable from anywhere.
 *
 * The Base UI kit does the opposite — a provider plus a hook, unreachable
 * outside the tree. Two kits, two incompatible notification models. The contract
 * exposes `useToast().show(...)`, which both can implement, and the app never
 * finds out which model it is sitting on.
 */
const DISMISS_AFTER_MS = 4500;

let items: StudioToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function push(input: StudioToastInput): number {
  const item: StudioToastItem = {
    id: nextId,
    level: input.level ?? "info",
    text: input.text,
    detail: input.detail,
  };
  nextId += 1;
  items = [...items, item];
  emit();
  setTimeout(() => dismiss(item.id), DISMISS_AFTER_MS);
  return item.id;
}

function dismiss(id: number): void {
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) {
    return;
  }
  items = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getItems(): StudioToastItem[] {
  return items;
}

const studioToast = { push, dismiss, subscribe, getItems };

export { studioToast };
export type { StudioToastItem, StudioToastLevel };
