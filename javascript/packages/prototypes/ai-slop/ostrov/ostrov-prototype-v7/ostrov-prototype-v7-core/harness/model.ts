import generated from "./model.generated.json";

type NodeKind = "class" | "type";
type EdgeKind = "extends" | "creates" | "uses";

type Field = {
  name: string;
  type: string;
  tags: string[];
};

type Method = {
  name: string;
  params: string;
  returns: string;
  tags: string[];
};

type ModelNode = {
  id: string;
  kind: NodeKind;
  file: string;
  doc: string;
  fields: Field[];
  properties: Field[];
  methods: Method[];
  exported: boolean;
};

type ModelEdge = {
  from: string;
  to: string;
  kind: EdgeKind;
  members: string[];
};

type Model = {
  package: string;
  generatedAt: string;
  nodes: ModelNode[];
  edges: ModelEdge[];
};

// tools/extract-model.mjs writes the JSON from the package sources. The cast is
// the one place the harness trusts that file.
const model = generated as unknown as Model;

const signatureOf = (method: Method): string => {
  const returns = method.returns ? `: ${method.returns}` : "";

  return `${method.name}(${method.params})${returns}`;
};

export { model, signatureOf };
export type { EdgeKind, Field, Method, Model, ModelEdge, ModelNode, NodeKind };
