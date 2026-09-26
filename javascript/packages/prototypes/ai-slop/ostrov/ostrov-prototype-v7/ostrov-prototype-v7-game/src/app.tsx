import { useSignals } from "@preact/signals-react/runtime";
import type { FC } from "react";
import "./app.css";

type AppProps = {
};

const App: FC<AppProps> = () => {
  useSignals();

  return (
    <div
      className="app"
    >
      {`todo`}
    </div>
  );
};

export { App };
