// Data shapes are shared with the backend through the protocol package. This file adds the
// frontend boundary on top of them: the `TApi` contract every api implementation fulfils.
import type {
  TCreateNodeInput,
  TCreateNodeResult,
  TDocument,
  TExcalidrawDocument,
  TExcalidrawScene,
  TExcalidrawStyle,
  TFsFileKind,
  TFsNode,
  TFsNodeKind,
  TJsonValue,
  TMarkdownDocument,
  TTextDocument,
  TTreeState,
} from "@hw/harwex-notes-protocol";

export type {
  TCreateNodeInput,
  TCreateNodeResult,
  TDocument,
  TExcalidrawDocument,
  TExcalidrawScene,
  TExcalidrawStyle,
  TFsFileKind,
  TFsNode,
  TFsNodeKind,
  TJsonValue,
  TMarkdownDocument,
  TTextDocument,
  TTreeState,
};
