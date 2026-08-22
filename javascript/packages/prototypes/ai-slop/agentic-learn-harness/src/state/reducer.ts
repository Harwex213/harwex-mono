import type {
  ContextMode,
  ContextUsed,
  Graph,
  LearnNode,
  NodeUsage,
  PromptImage,
  ToolCall,
} from "../../shared/types.ts";
import { placeChild, placeRoot, subtreeIds } from "./layout.ts";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

type Settings = {
  model: string;
  effort: Effort;
  contextMode: ContextMode;
};

type Notice = {
  id: string;
  text: string;
};

type State = {
  nodes: LearnNode[];
  /** Rendered card heights, keyed by node id. Measured, never persisted. */
  heights: Record<string, number>;
  topic: string;
  selectedId: string | null;
  settings: Settings;
  notices: Notice[];
  loaded: boolean;
};

type Action =
  | { type: "graph/loaded"; graph: Graph }
  | { type: "root/created"; id: string }
  | { type: "branch/created"; id: string; parentId: string }
  | { type: "node/patched"; id: string; patch: Partial<LearnNode> }
  | { type: "node/promptChanged"; id: string; prompt: string }
  | { type: "node/imagesChanged"; id: string; images: PromptImage[] }
  | { type: "node/started"; id: string; contextUsed: ContextUsed; sentPrompt: string }
  | { type: "node/answerAppended"; id: string; delta: string }
  | { type: "node/thinkingAppended"; id: string; delta: string }
  | { type: "node/toolCalled"; id: string; call: ToolCall }
  | { type: "node/finished"; id: string; sessionId: string | null; usage: NodeUsage }
  | { type: "node/failed"; id: string; message: string }
  | { type: "node/moved"; id: string; x: number; y: number }
  | { type: "node/measured"; id: string; height: number }
  | { type: "node/collapseToggled"; id: string }
  | { type: "node/deleted"; id: string }
  | { type: "node/selected"; id: string | null }
  | { type: "topic/changed"; topic: string }
  | { type: "settings/patched"; patch: Partial<Settings> }
  | { type: "notice/pushed"; id: string; text: string }
  | { type: "notice/dismissed"; id: string };

const INITIAL_STATE: State = {
  nodes: [],
  heights: {},
  topic: "",
  selectedId: null,
  settings: {
    model: "claude-opus-5",
    effort: "high",
    contextMode: "auto",
  },
  notices: [],
  loaded: false,
};

function emptyNode(id: string, parentId: string | null, x: number, y: number): LearnNode {
  return {
    id,
    parentId,
    prompt: "",
    images: [],
    answer: "",
    thinking: "",
    status: "draft",
    error: null,
    sessionId: null,
    contextMode: "auto",
    contextUsed: null,
    sentPrompt: null,
    toolCalls: [],
    usage: null,
    x,
    y,
    collapsed: false,
    createdAt: Date.now(),
  };
}

function mapNode(state: State, id: string, change: (node: LearnNode) => LearnNode): State {
  let touched = false;
  const nodes = state.nodes.map((node) => {
    if (node.id !== id) {
      return node;
    }
    touched = true;
    return change(node);
  });
  if (!touched) {
    return state;
  }
  return { ...state, nodes };
}

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "graph/loaded": {
      // A node left mid-stream by a reload has no live turn to reattach to.
      const nodes = action.graph.nodes.map((node) => {
        if (node.status !== "streaming") {
          return node;
        }
        return {
          ...node,
          status: node.answer.length > 0 ? ("done" as const) : ("error" as const),
          error: node.answer.length > 0 ? null : "The turn was interrupted by a reload.",
        };
      });
      return {
        ...state,
        nodes,
        topic: action.graph.topic,
        loaded: true,
        selectedId: nodes.length > 0 ? nodes[nodes.length - 1].id : null,
      };
    }
    case "root/created": {
      const spot = placeRoot(state.nodes);
      const node = emptyNode(action.id, null, spot.x, spot.y);
      return { ...state, nodes: [...state.nodes, node], selectedId: node.id };
    }
    case "branch/created": {
      const parent = state.nodes.find((candidate) => {
        return candidate.id === action.parentId;
      });
      if (!parent) {
        return state;
      }
      const spot = placeChild(state.nodes, state.heights, parent);
      const node = emptyNode(action.id, parent.id, spot.x, spot.y);
      return { ...state, nodes: [...state.nodes, node], selectedId: node.id };
    }
    case "node/patched": {
      return mapNode(state, action.id, (node) => {
        return { ...node, ...action.patch };
      });
    }
    case "node/promptChanged": {
      return mapNode(state, action.id, (node) => {
        return { ...node, prompt: action.prompt };
      });
    }
    case "node/imagesChanged": {
      return mapNode(state, action.id, (node) => {
        return { ...node, images: action.images };
      });
    }
    case "node/started": {
      return mapNode(state, action.id, (node) => {
        return {
          ...node,
          status: "streaming",
          error: null,
          answer: "",
          thinking: "",
          toolCalls: [],
          usage: null,
          contextUsed: action.contextUsed,
          sentPrompt: action.sentPrompt,
          contextMode: state.settings.contextMode,
        };
      });
    }
    case "node/answerAppended": {
      return mapNode(state, action.id, (node) => {
        return { ...node, answer: node.answer + action.delta };
      });
    }
    case "node/thinkingAppended": {
      return mapNode(state, action.id, (node) => {
        return { ...node, thinking: node.thinking + action.delta };
      });
    }
    case "node/toolCalled": {
      return mapNode(state, action.id, (node) => {
        if (node.toolCalls.some((call) => {
          return call.id === action.call.id;
        })) {
          return node;
        }
        return { ...node, toolCalls: [...node.toolCalls, action.call] };
      });
    }
    case "node/finished": {
      return mapNode(state, action.id, (node) => {
        return {
          ...node,
          status: "done",
          sessionId: action.sessionId ?? node.sessionId,
          usage: action.usage,
        };
      });
    }
    case "node/failed": {
      return mapNode(state, action.id, (node) => {
        return { ...node, status: "error", error: action.message };
      });
    }
    case "node/moved": {
      return mapNode(state, action.id, (node) => {
        return { ...node, x: action.x, y: action.y };
      });
    }
    case "node/measured": {
      if (state.heights[action.id] === action.height) {
        return state;
      }
      return { ...state, heights: { ...state.heights, [action.id]: action.height } };
    }
    case "node/collapseToggled": {
      return mapNode(state, action.id, (node) => {
        return { ...node, collapsed: !node.collapsed };
      });
    }
    case "node/deleted": {
      const doomed = subtreeIds(state.nodes, action.id);
      const nodes = state.nodes.filter((node) => {
        return !doomed.has(node.id);
      });
      const selectedId = state.selectedId !== null && doomed.has(state.selectedId)
        ? null
        : state.selectedId;
      const heights = { ...state.heights };
      for (const id of doomed) {
        delete heights[id];
      }
      return { ...state, nodes, heights, selectedId };
    }
    case "node/selected": {
      return { ...state, selectedId: action.id };
    }
    case "topic/changed": {
      return { ...state, topic: action.topic };
    }
    case "settings/patched": {
      return { ...state, settings: { ...state.settings, ...action.patch } };
    }
    case "notice/pushed": {
      return { ...state, notices: [...state.notices, { id: action.id, text: action.text }] };
    }
    case "notice/dismissed": {
      return {
        ...state,
        notices: state.notices.filter((notice) => {
          return notice.id !== action.id;
        }),
      };
    }
    default: {
      return state;
    }
  }
}

export { INITIAL_STATE, reduce };
export type { Action, Effort, Notice, Settings, State };
