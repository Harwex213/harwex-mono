import { computed, signal } from "@preact/signals-react";
import { createContext, useContext } from "react";
import { deriveEmpire } from "../domain/tech/empire";
import { ROOT } from "../domain/tech/tech-tree";
import { CAMERA_HOME } from "../ui/render/snowflake-renderer";
import type { TCamera } from "../ui/render/snowflake-renderer";

/** A technology being learned: the ring on its node fills from startedAt. */
type TLearning = {
  techId: string;
  startedAt: number;
};

type TSize = {
  width: number;
  height: number;
};

const createStore = () => {
  const researched = signal<string[]>([ROOT.id]);

  return {
    techState: {
      researched,
      learning: signal<TLearning | null>(null),
      /** Buildings and units folded from the researched set. */
      empire: computed(() => deriveEmpire(researched.value)),
    },
    viewState: {
      hoveredId: signal<string | null>(null),
      /** performance.now() of the last hover change; drives the name reveal. */
      hoveredAt: signal(0),
      selectedId: signal<string | null>(null),
      camera: signal<TCamera>(CAMERA_HOME),
      /** Canvas CSS size; the popup anchors to a node through the same viewport as the renderer. */
      canvasSize: signal<TSize>({ width: 0, height: 0 }),
    },
  };
};

type TStore = ReturnType<typeof createStore>;

const StoreProvider = createContext<TStore>(null!);

const useStore = () => useContext(StoreProvider);

export type { TLearning, TSize, TStore };
export { StoreProvider, createStore, useStore };
