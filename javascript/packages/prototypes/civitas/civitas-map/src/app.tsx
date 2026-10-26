import type { TAppRegistry } from "./actions/index";
import { EditorPage } from "./ui/pages/editor/editor-page";

type TAppProps = {
  registry: TAppRegistry;
};

// The editor has one page. `App` stays the seam between the composition root and
// the UI.
function App({ registry }: TAppProps) {
  return <EditorPage registry={registry} />;
}

export { App };
