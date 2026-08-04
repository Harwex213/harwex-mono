import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

// No `StrictMode`: it double-invokes effects, and from T03 on the render effects
// here own a canvas each. A second pass would resize and repaint the canvas twice
// per change for no benefit.
createRoot(document.getElementById("root")!).render(<App />);
