import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/app";
import "./styles/reset.css";
import "./styles/builder.css";
import "./styles/canvas.css";
import "./styles/widgets.css";

const host = document.getElementById("root");

if (host) {
  createRoot(host).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
