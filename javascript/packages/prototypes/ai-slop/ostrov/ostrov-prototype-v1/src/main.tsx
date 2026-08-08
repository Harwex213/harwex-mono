import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

// No `StrictMode`: the canvas effect owns a requestAnimationFrame loop and the
// game instance. A double invoke would start a second loop over the same world.
createRoot(document.getElementById("root")!).render(<App />);
