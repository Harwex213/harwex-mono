import { useSignals } from "@preact/signals-react/runtime";
import { Chevron, NodeIcon } from "./fs-icons";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TOpenNodeAction } from "../../domain/registry";

type TFsViewerRegistrySlice = {
  openNodeAction: TOpenNodeAction;
};

type TFsViewerProps = {
  registry: TFsViewerRegistrySlice;
};

const INDENT_STEP_PX = 14;

const FsViewer: FC<TFsViewerProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const rows = store.derived.rows.value;
  const isLoading = store.fs.isLoading.value;
  const error = store.fs.error.value;
  const activeId = store.tabs.activeId.value;

  return (
    <aside className="fs">
      <header className="fs__header">
        <span className="fs__title">{"Vault"}</span>
        <span className="fs__count">{rows.length}</span>
      </header>

      <div className="fs__body">
        {isLoading ? <p className="fs__hint">{"Reading the vault…"}</p> : null}

        {error === null ? null : <p className="fs__error">{error}</p>}

        {rows.map((row) => (
          <button
            className={`fs__row${row.node.id === activeId ? " fs__row--active" : ""}`}
            key={row.node.id}
            onClick={() => registry.openNodeAction(row.node.id)}
            style={{ paddingLeft: `${8 + row.depth * INDENT_STEP_PX}px` }}
            type="button"
          >
            <span className="fs__twisty">
              {row.node.kind === "folder" ? <Chevron isExpanded={row.isExpanded} /> : null}
            </span>

            <NodeIcon kind={row.node.kind} />

            <span className="fs__name">{row.node.name}</span>
          </button>
        ))}
      </div>
    </aside>
  );
};

export { FsViewer };
