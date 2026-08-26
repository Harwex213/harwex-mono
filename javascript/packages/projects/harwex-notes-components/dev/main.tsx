import "./playground.css";
import { createRoot } from "react-dom/client";
import { loadDemos } from "./demos";
import { Playground } from "./playground";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(<Playground demos={loadDemos()} />);
