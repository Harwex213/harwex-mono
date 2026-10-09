import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import { getEngine } from "../engine/engine";
import type { Signal } from "@preact/signals-react";
import { activeTab, dolly, fps, isPlaying, isSolo, redoCount, renderMode, saveStatus, shot, spin, swing, transformMode, undoCount } from "../state";
import type { RenderMode, SaveStatus, Shot, TransformMode, ViewTab } from "../state";
import styles from "./Editor.module.css";
import { Hierarchy } from "./Hierarchy";
import { Inspector } from "./Inspector";

const TABS: { id: ViewTab; label: string; icon: string }[] = [
  { id: "scene", label: "Scene", icon: "#" },
  { id: "game", label: "Game", icon: "◧" },
];

const TOOLS: { mode: TransformMode; label: string; key: string }[] = [
  { mode: "translate", label: "Move", key: "W" },
  { mode: "rotate", label: "Rotate", key: "E" },
  { mode: "scale", label: "Scale", key: "R" },
];

const CHANNELS: { label: string; title: string; state: Signal<boolean> }[] = [
  { label: "Swing", title: "Slow crane drift of the camera", state: swing },
  { label: "Dolly", title: "Wide -> close -> wide camera move", state: dolly },
  { label: "Spin", title: "Wheel spin cycle", state: spin },
];

// Camera shots: a click makes the Main Camera travel to the shot.
const SHOT_BUTTONS: { shot: Shot; label: string; title: string }[] = [
  { shot: "wheel", label: "Main Wheel", title: "Hero wheel in the amphitheatre (?shot=wheel)" },
  { shot: "dice", label: "Bonus Dice", title: "The acrylic tower (?shot=dice)" },
  { shot: "show", label: "Bonus Show", title: "The jester wheel in the Game Show room (?shot=show)" },
  { shot: "luck", label: "Bonus LuckDeluxe", title: "The slot cabinet Bonus Luck (?shot=luck)" },
];

const RENDER_MODES: { mode: RenderMode; label: string; title: string }[] = [
  { mode: "editor", label: "Editor Lighting", title: "Static even light, matte floor, no bloom" },
  { mode: "game", label: "Game Lighting", title: "The lights of the show, as in the Game view" },
];

const SAVE_LABELS: Record<SaveStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  failed: "Save failed (dev server only)",
};

function Toolbar() {
  const engine = getEngine();
  useSignals();
  return (
    <header className={styles.toolbar}>
      <div className={styles.toolGroup}>
        {TOOLS.map((tool) => (
          <button
            key={tool.mode}
            type="button"
            title={`${tool.label} (${tool.key})`}
            className={[styles.toolButton, transformMode.value === tool.mode ? styles.toolButtonActive : ""].join(" ")}
            onClick={() => {
              transformMode.value = tool.mode;
            }}
          >
            {tool.label}
          </button>
        ))}
      </div>
      <div className={styles.toolGroup}>
        <button
          type="button"
          title="Play / Pause animation"
          className={[styles.playButton, isPlaying.value ? styles.playButtonActive : ""].join(" ")}
          onClick={() => {
            isPlaying.value = !isPlaying.value;
          }}
        >
          {isPlaying.value ? "❚❚" : "▶"}
        </button>
        {CHANNELS.map((channel) => (
          <button
            key={channel.label}
            type="button"
            title={channel.title}
            className={[styles.toolButton, channel.state.value ? styles.toolButtonActive : ""].join(" ")}
            onClick={() => {
              channel.state.value = !channel.state.value;
            }}
          >
            {channel.label}
          </button>
        ))}
      </div>
      <div className={styles.toolGroup}>
        {SHOT_BUTTONS.map((item) => (
          <button
            key={item.shot}
            type="button"
            title={item.title}
            className={[styles.toolButton, shot.value === item.shot ? styles.toolButtonActive : ""].join(" ")}
            onClick={() => {
              shot.value = item.shot;
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className={styles.toolGroup}>
        <button
          type="button"
          title="Undo (Ctrl+Z)"
          className={styles.toolButton}
          disabled={undoCount.value === 0}
          onClick={() => {
            engine.document.undo();
          }}
        >
          Undo
        </button>
        <button
          type="button"
          title="Redo (Ctrl+Shift+Z or Ctrl+Y)"
          className={styles.toolButton}
          disabled={redoCount.value === 0}
          onClick={() => {
            engine.document.redo();
          }}
        >
          Redo
        </button>
        <span className={[styles.toolbarNote, saveStatus.value === "saved" ? "" : styles.toolbarNoteAlert].join(" ")}>
          {SAVE_LABELS[saveStatus.value]}
        </span>
        <button
          type="button"
          title="Put every object back to the values from code"
          className={styles.toolButton}
          onClick={() => {
            engine.document.revert();
          }}
        >
          Revert
        </button>
        <button
          type="button"
          title="Write the edits to src/scene/scene-overrides.json (Ctrl+S)"
          className={styles.toolButton}
          onClick={() => {
            void engine.document.save();
          }}
        >
          Save
        </button>
      </div>
    </header>
  );
}

function ViewTabs() {
  useSignals();
  return (
    <div className={styles.tabStrip}>
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={[styles.tab, activeTab.value === tab.id ? styles.tabActive : ""].join(" ")}
          onClick={() => {
            activeTab.value = tab.id;
          }}
        >
          <span className={styles.tabIcon}>{tab.icon}</span>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function SceneView() {
  useSignals();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const engine = getEngine();
    if (ref.current) {
      engine.attach("scene", ref.current);
    }
    return () => {
      engine.detach("scene");
    };
  }, []);
  return (
    <div className={styles.viewPane} hidden={activeTab.value !== "scene"}>
      <div className={styles.viewBar}>
        {RENDER_MODES.map((item) => (
          <button
            key={item.mode}
            type="button"
            title={item.title}
            className={[styles.viewBarButton, renderMode.value === item.mode ? styles.viewBarButtonActive : ""].join(" ")}
            onClick={() => {
              renderMode.value = item.mode;
            }}
          >
            {item.label}
          </button>
        ))}
        <span className={styles.viewBarHint}>
          RMB look + WASD fly, Q/E down/up, Shift fast · Alt+LMB orbit · MMB pan · wheel zoom · click to select · W/E/R tools · F focus · Del delete · F2 rename
        </span>
      </div>
      <div ref={ref} className={styles.viewport} />
    </div>
  );
}

function GameView() {
  useSignals();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const engine = getEngine();
    if (ref.current) {
      engine.attach("game", ref.current);
    }
    return () => {
      engine.detach("game");
    };
  }, []);
  return (
    <div className={styles.viewPane} hidden={activeTab.value !== "game"}>
      <div className={styles.viewBar}>
        <span className={styles.viewBarItem}>Display 1</span>
        <span className={styles.viewBarItem}>16:9 Aspect</span>
        <span className={styles.viewBarHint}>{fps.value} fps</span>
      </div>
      <div className={styles.gameStage}>
        <div ref={ref} className={styles.gameFrame} />
      </div>
    </div>
  );
}

function SoloGameView() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const engine = getEngine();
    if (ref.current) {
      engine.attach("game", ref.current);
    }
    return () => {
      engine.detach("game");
    };
  }, []);
  return (
    <div ref={ref} className={styles.soloStage} />
  );
}

function App() {
  const engine = getEngine();
  if (isSolo) {
    return <SoloGameView />;
  }
  return (
    <div className={styles.app}>
      <Toolbar />
      <div className={styles.workspace}>
        <Hierarchy root={engine.root} />
        <main className={styles.center}>
          <ViewTabs />
          <SceneView />
          <GameView />
        </main>
        <Inspector root={engine.root} />
      </div>
    </div>
  );
}

export { App };
