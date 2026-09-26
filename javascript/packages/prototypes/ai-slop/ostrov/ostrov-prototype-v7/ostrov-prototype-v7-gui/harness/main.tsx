import { createRoot } from "react-dom/client";
import { Harness } from "./harness";

const main = (): void => {
  const container = document.querySelector("#root");

  if (!container) {
    throw new Error("No #root was found to mount the harness");
  }

  createRoot(container).render(<Harness />);
};

main();
