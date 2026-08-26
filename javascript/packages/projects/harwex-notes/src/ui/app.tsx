import { FsViewer } from "./components/fs-viewer";
import { TabsBar } from "./components/tabs-bar";
import { ViewerPane } from "./components/viewer-pane";
import type { FC } from "react";
import type { TAppRegistry } from "../domain/registry";

type TAppProps = {
  registry: TAppRegistry;
};

const App: FC<TAppProps> = ({ registry }) => {
  return (
    <div className="app">
      <FsViewer registry={registry} />

      <main className="app__main">
        <TabsBar registry={registry} />

        <ViewerPane registry={registry} />
      </main>
    </div>
  );
};

export { App };
