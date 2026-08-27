import type { FC } from "react";
import type { TAppRegistry } from "@hw/harwex-notes-protocol";
import { FsViewerContainer } from "./components/fs-viewer-container";
import { ViewerPane } from "./components/viewer-pane";
import { TabsBar } from "./components/tabs-bar";

type TAppProps = {
  registry: TAppRegistry;
};

const App: FC<TAppProps> = ({ registry }) => {
  return (
    <div className="app">
      <FsViewerContainer registry={registry} />

      <main className="app__main">
        <TabsBar registry={registry} />

        <ViewerPane registry={registry} />
      </main>
    </div>
  );
};

export { App };
