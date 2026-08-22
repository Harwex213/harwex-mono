/**
 * Types shared between the browser app and the harness server.
 * Kept free of imports so both tsconfig projects can include it.
 */

type NodeStatus = "draft" | "streaming" | "done" | "error" | "cancelled";

/** How the harness should assemble context for a branch. */
type ContextMode = "auto" | "fork" | "rebuild";

/** How the harness actually assembled context for a finished node. */
type ContextUsed = "root" | "fork" | "rebuild";

type PromptImage = {
  id: string;
  name: string;
  mediaType: string;
  bytes: number;
};

type ToolCall = {
  id: string;
  name: string;
  summary: string;
};

type NodeUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  durationMs: number;
  numTurns: number;
  model: string;
};

type LearnNode = {
  id: string;
  parentId: string | null;
  prompt: string;
  images: PromptImage[];
  answer: string;
  thinking: string;
  status: NodeStatus;
  error: string | null;
  /** Agent session this node's answer ended in. Lets children fork from it. */
  sessionId: string | null;
  contextMode: ContextMode;
  contextUsed: ContextUsed | null;
  /** The exact prompt text the harness sent, for inspection. */
  sentPrompt: string | null;
  toolCalls: ToolCall[];
  usage: NodeUsage | null;
  x: number;
  y: number;
  collapsed: boolean;
  createdAt: number;
};

type Graph = {
  version: 1;
  topic: string;
  nodes: LearnNode[];
  updatedAt: number;
};

/** One ancestor turn, as the client hands it to the harness. */
type AncestorTurn = {
  prompt: string;
  answer: string;
  imageCount: number;
};

type AskRequest = {
  nodeId: string;
  prompt: string;
  images: PromptImage[];
  /** Root first, immediate parent last. Empty for a root node. */
  ancestors: AncestorTurn[];
  /** Session of the immediate parent, when it has one. */
  parentSessionId: string | null;
  contextMode: ContextMode;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
};

type AskEvent =
  | { type: "start"; contextUsed: ContextUsed; sentPrompt: string }
  | { type: "session"; sessionId: string }
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "tool"; call: ToolCall }
  | { type: "notice"; message: string }
  | { type: "done"; sessionId: string | null; usage: NodeUsage }
  | { type: "error"; message: string };

type UploadedImage = PromptImage;

export type {
  AncestorTurn,
  AskEvent,
  AskRequest,
  ContextMode,
  ContextUsed,
  Graph,
  LearnNode,
  NodeStatus,
  NodeUsage,
  PromptImage,
  ToolCall,
  UploadedImage,
};
