import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
// AFTER `./index.css`, so its `:root` block wins on equal specificity and
// re-points T01's palette onto the `--civ-*` tokens.
import "./ui/theme.css";

// No `StrictMode`: it double-invokes effects, and from T03 on the render effects
// here own a canvas each. A second pass would resize and repaint the canvas twice
// per change for no benefit.
createRoot(document.getElementById("root")!).render(<App />);
