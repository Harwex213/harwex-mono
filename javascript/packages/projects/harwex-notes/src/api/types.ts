type TFsNodeKind = "folder" | "markdown" | "excalidraw";

type TFsNode = {
  id: string;
  parentId: string | null;
  name: string;
  kind: TFsNodeKind;
};

type TMarkdownDocument = {
  kind: "markdown";
  nodeId: string;
  text: string;
};

type TExcalidrawColor = "ink" | "blue" | "green" | "orange" | "violet";

type TExcalidrawPoint = readonly [number, number];

type TExcalidrawShape =
  | {
    type: "rect";
    x: number;
    y: number;
    width: number;
    height: number;
    color: TExcalidrawColor;
    label?: string;
  }
  | {
    type: "ellipse";
    x: number;
    y: number;
    width: number;
    height: number;
    color: TExcalidrawColor;
    label?: string;
  }
  | {
    type: "arrow";
    points: readonly TExcalidrawPoint[];
    color: TExcalidrawColor;
    label?: string;
  }
  | {
    type: "text";
    x: number;
    y: number;
    text: string;
    color: TExcalidrawColor;
    size: "small" | "medium" | "large";
  };

type TExcalidrawDocument = {
  kind: "excalidraw";
  nodeId: string;
  width: number;
  height: number;
  shapes: readonly TExcalidrawShape[];
};

type TDocument = TMarkdownDocument | TExcalidrawDocument;

type TCreateNodeInput = {
  parentId: string | null;
  name: string;
  kind: TFsNodeKind;
};

type TCreateNodeResult = {
  nodes: readonly TFsNode[];
  node: TFsNode;
};

type TApi = {
  fetchTree: () => Promise<readonly TFsNode[]>;
  fetchDocument: (nodeId: string) => Promise<TDocument>;
  createNode: (input: TCreateNodeInput) => Promise<TCreateNodeResult>;
  renameNode: (nodeId: string, name: string) => Promise<readonly TFsNode[]>;
  moveNode: (nodeId: string, parentId: string | null) => Promise<readonly TFsNode[]>;
  deleteNode: (nodeId: string) => Promise<readonly TFsNode[]>;
};

export type {
  TApi,
  TCreateNodeInput,
  TCreateNodeResult,
  TDocument,
  TExcalidrawColor,
  TExcalidrawDocument,
  TExcalidrawPoint,
  TExcalidrawShape,
  TFsNode,
  TFsNodeKind,
  TMarkdownDocument,
};
