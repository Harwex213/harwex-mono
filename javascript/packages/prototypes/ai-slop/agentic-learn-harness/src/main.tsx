import { createRoot } from "react-dom/client";
import { App } from "./components/app.tsx";
import { HarnessProvider } from "./state/harness.tsx";
import "./styles/reset.css";
import "./styles/app.css";
import "./styles/canvas.css";
import "./styles/markdown.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("The #root element is missing from index.html.");
}

createRoot(container).render(
  <HarnessProvider>
    <App />
  </HarnessProvider>,
);
