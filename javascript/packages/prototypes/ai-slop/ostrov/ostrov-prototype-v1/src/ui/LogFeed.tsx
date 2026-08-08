import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useState } from "react";
import * as hud from "../game/hud";

function LogFeed(): React.JSX.Element {
  useSignals();
  return (
    <div className="logfeed">
      {hud.logEntries.value.map((entry) => (
        <div className={`log log-${entry.tone}`} key={entry.id}>
          {entry.text}
        </div>
      ))}
    </div>
  );
}

function Toast(): React.JSX.Element | null {
  useSignals();
  const current = hud.toast.value;
  const [shown, setShown] = useState<{ id: number; text: string } | null>(null);

  useEffect(() => {
    if (!current) {
      return;
    }
    setShown(current);
    const timer = window.setTimeout(() => setShown(null), 2200);
    return () => window.clearTimeout(timer);
  }, [current]);

  if (!shown) {
    return null;
  }
  return <div className="toast">{shown.text}</div>;
}

export { LogFeed, Toast };
