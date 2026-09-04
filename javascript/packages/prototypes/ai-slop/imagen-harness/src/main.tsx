import { createRoot } from "react-dom/client";
import { App } from "./ui/app.js";
import "./styles/app.css";

const host = document.getElementById("root");
if (!host) {
  throw new Error("index.html lost its #root.");
}

createRoot(host).render(<App />);
