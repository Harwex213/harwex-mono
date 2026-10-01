import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import { getEngine } from "../engine/engine";
import { activeTab, fps, isPlaying, isSolo, transformMode } from "../state";
import type { TransformMode, ViewTab } from "../state";
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

function Toolbar() {
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
      </div>
      <div className={styles.toolGroup}>
        <span className={styles.toolbarNote}>Game Show Studio · blocking</span>
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
        <span className={styles.viewBarItem}>Shaded</span>
        <span className={styles.viewBarItem}>Persp</span>
        <span className={styles.viewBarHint}>LMB orbit · RMB pan · wheel zoom · click to select · W/E/R tools · F focus</span>
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
    <div className={styles.soloStage}>
      <div ref={ref} className={styles.gameFrame} />
    </div>
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
        <Hierarchy root={engine.studio.root} />
        <main className={styles.center}>
          <ViewTabs />
          <SceneView />
          <GameView />
        </main>
        <Inspector root={engine.studio.root} />
      </div>
    </div>
  );
}

export { App };
