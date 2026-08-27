import type {
  TFetchTree,
  TFetchDocument,
  TCreateNode,
  TRenameNode,
  TMoveNode,
  TDeleteNode,
} from "./fs-service.types.js";

const fetchTree: TFetchTree = () => {
  throw new Error("not implemented");
};

const fetchDocument: TFetchDocument = () => {
  throw new Error("not implemented");
};

const createNode: TCreateNode = () => {
  throw new Error("not implemented");
};

const renameNode: TRenameNode = () => {
  throw new Error("not implemented");
};

const moveNode: TMoveNode = () => {
  throw new Error("not implemented");
};

const deleteNode: TDeleteNode = () => {
  throw new Error("not implemented");
};

export {
  fetchTree,
  fetchDocument,
  createNode,
  renameNode,
  moveNode,
  deleteNode,
}
