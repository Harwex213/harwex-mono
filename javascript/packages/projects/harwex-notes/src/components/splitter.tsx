import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState } from "react";
import { panelWidth, setPanelWidth } from "../state/layout.ts";

function Splitter() {
  useSignals();
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(panelWidth.value);
  widthRef.current = panelWidth.value;

  useEffect(() => {
    if (!dragging) {
      return undefined;
    }
    const onMove = (event: PointerEvent): void => {
      setPanelWidth(event.clientX);
    };
    const onUp = (): void => {
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging]);

  return (
    <div
      className={dragging ? "splitter dragging" : "splitter"}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the file panel"
      aria-valuenow={Math.round(panelWidth.value)}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          setPanelWidth(widthRef.current - 16);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          setPanelWidth(widthRef.current + 16);
        }
      }}
    />
  );
}

export { Splitter };
