import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ShowcaseApp } from "./showcase-app";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ShowcaseApp />
  </StrictMode>,
);
