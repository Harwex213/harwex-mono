/** Types the renderer and the Electron main process both speak. */

type NodeKind =
  | "text"
  | "prompt-generator"
  | "prompt"
  | "image-generator"
  | "image";

type RunStatus = "idle" | "running" | "done" | "failed";

interface NodeBase {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
}

/** Free text the user writes. Lives in the graph file. */
interface TextNode extends NodeBase {
  kind: "text";
  text: string;
}

/** Turns the text nodes wired into it into one image prompt. */
interface PromptGeneratorNode extends NodeBase {
  kind: "prompt-generator";
  /** The prompt node this generator owns. One generator, one output. */
  outputId: string | null;
}

/** The generated prompt. The text itself lives in `prompts/<id>.md`. */
interface PromptNode extends NodeBase {
  kind: "prompt";
  /** The generator that owns this node. It can never be unlinked. */
  generatorId: string;
  expanded: boolean;
}

/** Runs a model over whatever is wired into it and writes an image. */
interface ImageGeneratorNode extends NodeBase {
  kind: "image-generator";
  model: string;
  dimensions: string;
}

/** A generated image. The bytes live in `images/<id>.png`. */
interface ImageNode extends NodeBase {
  kind: "image";
  /** The generator that produced it, when a generator did. */
  generatorId: string | null;
  /** What the image was generated from, kept for the tooltip. */
  caption: string;
}

type GraphNode =
  | TextNode
  | PromptGeneratorNode
  | PromptNode
  | ImageGeneratorNode
  | ImageNode;

interface GraphEdge {
  id: string;
  from: string;
  to: string;
}

interface Graph {
  version: 1;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** One tab, one working directory. The directory is the identity, so `id` is it. */
interface Tab {
  id: string;
  dir: string;
  name: string;
}

/** A working directory the app has opened before, whether it is open now or not. */
interface Recent {
  dir: string;
  name: string;
  lastOpenedAt: number;
  /** How many nodes its graph held when it was last saved. */
  nodeCount: number;
  isOpen: boolean;
  /** The directory is no longer on disk. It can be forgotten, not opened. */
  missing: boolean;
}

/** One wired-in source, already resolved to something the agent can be handed. */
type RunInput =
  | { kind: "text"; text: string }
  | { kind: "prompt"; id: string }
  | { kind: "image"; id: string };

interface RunRequest {
  dir: string;
  generatorId: string;
  /** The node the run writes into. The renderer picks the id, so it can place the node first. */
  targetId: string;
  inputs: RunInput[];
}

interface ImageRunRequest extends RunRequest {
  model: string;
  dimensions: string;
}

type RunEvent =
  | { type: "started"; generatorId: string; targetId: string }
  | { type: "tool"; generatorId: string; name: string; detail: string }
  | { type: "text"; generatorId: string; text: string }
  | { type: "done"; generatorId: string; targetId: string; caption: string }
  | { type: "failed"; generatorId: string; targetId: string; message: string };

interface RunResult {
  ok: boolean;
  message: string;
}

const IMAGE_MODELS = [
  "chatgpt images",
  "recraft",
  "nano banana 2",
  "nano banana pro",
] as const;

const IMAGE_DIMENSIONS = [
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "1920x1080",
  "1080x1920",
] as const;

export type {
  Graph,
  GraphEdge,
  GraphNode,
  ImageGeneratorNode,
  ImageNode,
  ImageRunRequest,
  NodeKind,
  PromptGeneratorNode,
  PromptNode,
  Recent,
  RunEvent,
  RunInput,
  RunRequest,
  RunResult,
  RunStatus,
  Tab,
  TextNode,
};
export { IMAGE_DIMENSIONS, IMAGE_MODELS };
