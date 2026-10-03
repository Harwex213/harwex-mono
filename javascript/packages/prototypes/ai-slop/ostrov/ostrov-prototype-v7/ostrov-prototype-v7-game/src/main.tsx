import { createRoot } from "react-dom/client";
import { App } from "./app";

const main = (): void => {
  const container = document.querySelector("#root");

  if (!container) {
    throw new Error("No #root was found to mount the app");
  }

  createRoot(container).render(<App />);
};

main();
