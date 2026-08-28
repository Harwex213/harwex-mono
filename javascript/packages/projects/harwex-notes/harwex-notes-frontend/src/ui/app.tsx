import { useSignals } from "@preact/signals-react/runtime";
import { FsViewerContainer } from "./components/fs-viewer-container";
import { SplitController } from "./components/split-controller";
import { TabsBarContainer } from "./components/tabs-bar-container";
import { ViewerPane } from "./components/viewer-pane";
import { MAX_SIDEBAR_WIDTH_PX, MIN_SIDEBAR_WIDTH_PX } from "../store/layout-slice";
import { useStore } from "../store/store";
import { useEffect } from "react";
import type { CSSProperties, FC } from "react";
import type { TAppRegistry } from "@hw/harwex-notes-protocol";

type TAppProps = {
  registry: TAppRegistry;
};

const App: FC<TAppProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const sidebarWidth = store.layout.sidebarWidth.value;

  // Cmd+S (Ctrl+S elsewhere) flushes pending saves. The default is the browser's
  // "save page" dialog, which is never what the user means here.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isSaveChord = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
      if (!isSaveChord || event.key.toLowerCase() !== "s") {
        return;
      }

      event.preventDefault();
      registry.flushDocumentsAction();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [registry]);

  // The grid column reads its width from a custom property, so a drag re-lays out the
  // shell without either panel knowing its own size.
  const shellStyle = { "--app-sidebar-width": `${sidebarWidth}px` } as CSSProperties;

  return (
    <div className="app" style={shellStyle}>
      <FsViewerContainer registry={registry} />

      <SplitController
        label={"Vault panel width"}
        max={MAX_SIDEBAR_WIDTH_PX}
        min={MIN_SIDEBAR_WIDTH_PX}
        onResize={registry.resizeSidebarAction}
        size={sidebarWidth}
      />

      <main className="app__main">
        <div className="app__bar">
          <TabsBarContainer registry={registry} />
        </div>

        <ViewerPane registry={registry} />
      </main>

    </div>
  );
};

export { App };
