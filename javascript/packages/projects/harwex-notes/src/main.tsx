import { createRoot } from "react-dom/client";
import { App } from "./components/app.tsx";
import "./styles/reset.css";
import "./styles/app.css";
import "./styles/tree.css";
import "./styles/tabs.css";
import "./styles/editor.css";
import "./styles/markdown.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("The #root element is missing from index.html.");
}

// No StrictMode: its double-invoked effects would mount two Excalidraw
// instances and two EditorViews per tab.
createRoot(container).render(<App />);
