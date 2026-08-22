import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { ReactNode } from "react";
import type { AskRequest, Graph, PromptImage } from "../../shared/types.ts";
import { ask, loadGraph, saveGraph } from "../api/client.ts";
import { ancestorChain } from "./layout.ts";
import { INITIAL_STATE, reduce } from "./reducer.ts";
import type { Action, Settings, State } from "./reducer.ts";

type Harness = {
  state: State;
  dispatch: (action: Action) => void;
  createRoot: () => void;
  createBranch: (parentId: string) => void;
  submit: (nodeId: string) => void;
  cancel: (nodeId: string) => void;
  remove: (nodeId: string) => void;
  select: (nodeId: string | null) => void;
  move: (nodeId: string, x: number, y: number) => void;
  setPrompt: (nodeId: string, prompt: string) => void;
  setImages: (nodeId: string, images: PromptImage[]) => void;
  patchSettings: (patch: Partial<Settings>) => void;
  notify: (text: string) => void;
  isRunning: (nodeId: string) => boolean;
};

const HarnessContext = createContext<Harness | null>(null);

const SAVE_DEBOUNCE_MS = 700;

function toGraph(state: State): Graph {
  return {
    version: 1,
    topic: state.topic,
    nodes: state.nodes,
    updatedAt: Date.now(),
  };
}

function HarnessProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, INITIAL_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const running = useRef(new Map<string, AbortController>());

  useEffect(() => {
    let cancelled = false;
    loadGraph().then((graph) => {
      if (cancelled || !graph) {
        return;
      }
      dispatch({ type: "graph/loaded", graph });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!state.loaded) {
      return;
    }
    const timer = setTimeout(() => {
      saveGraph(toGraph(stateRef.current)).catch(() => {
        /* autosave is best effort; the canvas keeps working */
      });
    }, SAVE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [state.nodes, state.topic, state.loaded]);

  const notify = useCallback((text: string) => {
    const id = crypto.randomUUID();
    dispatch({ type: "notice/pushed", id, text });
    setTimeout(() => {
      dispatch({ type: "notice/dismissed", id });
    }, 6000);
  }, []);

  const submit = useCallback(
    (nodeId: string) => {
      const current = stateRef.current;
      const node = current.nodes.find((candidate) => {
        return candidate.id === nodeId;
      });
      if (!node || running.current.has(nodeId)) {
        return;
      }
      if (node.prompt.trim().length === 0 && node.images.length === 0) {
        notify("Write a question or attach an image first.");
        return;
      }

      const chain = ancestorChain(current.nodes, nodeId);
      const parent = chain[chain.length - 1] ?? null;
      const request: AskRequest = {
        nodeId,
        prompt: node.prompt,
        images: node.images,
        ancestors: chain.map((ancestor) => {
          return {
            prompt: ancestor.prompt,
            answer: ancestor.answer,
            imageCount: ancestor.images.length,
          };
        }),
        parentSessionId: parent?.sessionId ?? null,
        contextMode: current.settings.contextMode,
        model: current.settings.model,
        effort: current.settings.effort,
      };

      const controller = new AbortController();
      running.current.set(nodeId, controller);
      dispatch({
        type: "node/patched",
        id: nodeId,
        patch: {
          status: "streaming",
          error: null,
          answer: "",
          thinking: "",
          toolCalls: [],
          usage: null,
        },
      });

      let settled = false;
      ask(
        request,
        (event) => {
          switch (event.type) {
            case "start": {
              dispatch({
                type: "node/started",
                id: nodeId,
                contextUsed: event.contextUsed,
                sentPrompt: event.sentPrompt,
              });
              break;
            }
            case "session": {
              dispatch({
                type: "node/patched",
                id: nodeId,
                patch: { sessionId: event.sessionId },
              });
              break;
            }
            case "text": {
              dispatch({ type: "node/answerAppended", id: nodeId, delta: event.delta });
              break;
            }
            case "thinking": {
              dispatch({ type: "node/thinkingAppended", id: nodeId, delta: event.delta });
              break;
            }
            case "tool": {
              dispatch({ type: "node/toolCalled", id: nodeId, call: event.call });
              break;
            }
            case "notice": {
              notify(event.message);
              break;
            }
            case "done": {
              settled = true;
              dispatch({
                type: "node/finished",
                id: nodeId,
                sessionId: event.sessionId,
                usage: event.usage,
              });
              break;
            }
            case "error": {
              settled = true;
              dispatch({ type: "node/failed", id: nodeId, message: event.message });
              break;
            }
            default: {
              break;
            }
          }
        },
        controller.signal,
      )
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          settled = true;
          dispatch({
            type: "node/failed",
            id: nodeId,
            message: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          running.current.delete(nodeId);
          if (settled) {
            return;
          }
          const latest = stateRef.current.nodes.find((candidate) => {
            return candidate.id === nodeId;
          });
          if (!latest || latest.status !== "streaming") {
            return;
          }
          dispatch({
            type: "node/patched",
            id: nodeId,
            patch: {
              status: latest.answer.length > 0 ? "cancelled" : "draft",
            },
          });
        });
    },
    [notify],
  );

  const harness = useMemo<Harness>(() => {
    return {
      state,
      dispatch,
      createRoot: () => {
        dispatch({ type: "root/created", id: crypto.randomUUID() });
      },
      createBranch: (parentId: string) => {
        dispatch({ type: "branch/created", id: crypto.randomUUID(), parentId });
      },
      submit,
      cancel: (nodeId: string) => {
        running.current.get(nodeId)?.abort();
      },
      remove: (nodeId: string) => {
        running.current.get(nodeId)?.abort();
        dispatch({ type: "node/deleted", id: nodeId });
      },
      select: (nodeId: string | null) => {
        dispatch({ type: "node/selected", id: nodeId });
      },
      move: (nodeId: string, x: number, y: number) => {
        dispatch({ type: "node/moved", id: nodeId, x, y });
      },
      setPrompt: (nodeId: string, prompt: string) => {
        dispatch({ type: "node/promptChanged", id: nodeId, prompt });
      },
      setImages: (nodeId: string, images: PromptImage[]) => {
        dispatch({ type: "node/imagesChanged", id: nodeId, images });
      },
      patchSettings: (patch: Partial<Settings>) => {
        dispatch({ type: "settings/patched", patch });
      },
      notify,
      isRunning: (nodeId: string) => {
        return running.current.has(nodeId);
      },
    };
  }, [state, submit, notify]);

  return <HarnessContext.Provider value={harness}>{children}</HarnessContext.Provider>;
}

function useHarness(): Harness {
  const harness = useContext(HarnessContext);
  if (!harness) {
    throw new Error("useHarness must be used inside HarnessProvider.");
  }
  return harness;
}

export { HarnessProvider, useHarness };
