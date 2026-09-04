import { useSignals } from "@preact/signals-react/runtime";
import { useEffect } from "react";
import {
  activeTab,
  copyNode,
  createTab,
  deleteNode,
  initTabs,
  notice,
  pasteImage,
  selectedId,
  setNotice,
} from "../state/graph-state.js";
import { fitContent } from "../state/framing.js";
import { setScale, viewport } from "../state/viewport.js";
import { Canvas } from "./canvas.js";
import { RecentsList } from "./recents-list.js";
import { TabBar } from "./tab-bar.js";

/** A key press inside a field belongs to the field, not to the canvas. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.tagName === "TEXTAREA" ||
    target.tagName === "INPUT" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

function canvasBox(): DOMRect | null {
  return document.querySelector(".canvas")?.getBoundingClientRect() ?? null;
}

function App(): React.JSX.Element {
  useSignals();

  useEffect(() => {
    void initTabs();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Cmd on a Mac, Ctrl on Windows and Linux: both mean "the command key".
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key === "1") {
        event.preventDefault();
        fitContent();
        return;
      }
      if (command && (event.key === "0" || event.key === "=" || event.key === "-")) {
        const box = canvasBox();
        if (box) {
          event.preventDefault();
          const scale =
            event.key === "0" ? 1 : viewport.value.scale * (event.key === "-" ? 0.8 : 1.25);
          setScale(scale, box);
        }
        return;
      }
      if (isTyping(event.target)) {
        return;
      }
      const id = selectedId.value;
      if (command && event.key.toLowerCase() === "c" && id) {
        event.preventDefault();
        void copyNode(id);
        return;
      }
      if (command && event.key.toLowerCase() === "v") {
        const box = canvasBox();
        if (!box) {
          return;
        }
        event.preventDefault();
        const view = viewport.value;
        void pasteImage(
          (box.width / 2 - view.x) / view.scale - 150,
          (box.height / 2 - view.y) / view.scale - 100,
        ).then((pasted) => {
          if (!pasted) {
            setNotice("There is no image on the clipboard.");
          }
        });
        return;
      }
      if ((event.key === "Backspace" || event.key === "Delete") && id) {
        event.preventDefault();
        void deleteNode(id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (notice.value.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      setNotice("");
    }, 2600);
    return () => {
      clearTimeout(timer);
    };
  }, [notice.value]);

  return (
    <div className="app">
      <TabBar />
      {activeTab.value ? <Canvas /> : <Welcome />}
      {notice.value.length > 0 ? <div className="notice">{notice.value}</div> : null}
    </div>
  );
}

function Welcome(): React.JSX.Element {
  useSignals();
  return (
    <div className="welcome">
      <div className="welcome__intro">
        <h1>imagen harness</h1>
        <p>
          Every tab is one working directory. The graph lives in <code>graph.json</code> there,
          prompts under <code>prompts/</code>, images under <code>images/</code>.
        </p>
        <button
          type="button"
          className="welcome__open"
          onClick={() => {
            void createTab();
          }}
        >
          Open a directory…
        </button>
      </div>
      <div className="welcome__recents">
        <p className="drop__title">Previous working directories</p>
        <RecentsList empty="None yet. Open a directory and it will be waiting here next time." />
      </div>
    </div>
  );
}

export { App };
