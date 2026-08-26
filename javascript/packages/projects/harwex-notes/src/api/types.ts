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

type TApi = {
  fetchTree: () => Promise<readonly TFsNode[]>;
  fetchDocument: (nodeId: string) => Promise<TDocument>;
};

export type {
  TApi,
  TDocument,
  TExcalidrawColor,
  TExcalidrawDocument,
  TExcalidrawPoint,
  TExcalidrawShape,
  TFsNode,
  TFsNodeKind,
  TMarkdownDocument,
};
