import { useSignals } from "@preact/signals-react/runtime";
import { MAX_SIZE, MIN_SIZE } from "../map/brush";
import {
  brushShape,
  brushSize,
  canRedo,
  canUndo,
  clearLayer,
  layerOpacity,
  layerVisible,
  mapInfo,
  redo,
  setBrushSize,
  showBaseMap,
  tool,
  undo,
  type Tool,
} from "../state/editor-state";
import styles from "./toolbar.module.css";

const TOOLS: Array<{ id: Tool; label: string; hint: string }> = [
  { id: "brush", label: "Brush", hint: "B — freehand paint with the active province" },
  { id: "bucket", label: "Bucket", hint: "G — fill the area under the cursor up to your strokes" },
  { id: "eraser", label: "Eraser", hint: "E — clear paint (or hold the right mouse button)" },
  { id: "picker", label: "Picker", hint: "I — make the province under the cursor active" },
];

const SIZE_PRESETS = [1, 4, 12, 32, 64];

function Toolbar() {
  useSignals();

  const disabled = mapInfo.value === null;

  return (
    <aside className={styles.panel}>
      <section className={styles.section}>
        <h2 className={styles.heading}>Tools</h2>
        <div className={styles.tools}>
          {TOOLS.map((entry) => (
            <button
              className={entry.id === tool.value ? `${styles.tool} ${styles.toolActive}` : styles.tool}
              disabled={disabled}
              key={entry.id}
              onClick={() => {
                tool.value = entry.id;
              }}
              title={entry.hint}
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>
          Brush<span className={styles.value}>{brushSize.value} px</span>
        </h2>
        <input
          disabled={disabled}
          max={MAX_SIZE}
          min={MIN_SIZE}
          onChange={(event) => {
            setBrushSize(Number(event.target.value));
          }}
          type="range"
          value={brushSize.value}
        />
        <div className={styles.presets}>
          {SIZE_PRESETS.map((size) => (
            <button
              className={styles.preset}
              disabled={disabled}
              key={size}
              onClick={() => {
                setBrushSize(size);
              }}
              type="button"
            >
              {size}
            </button>
          ))}
        </div>
        <div className={styles.shapes}>
          {(["circle", "square"] as const).map((shape) => (
            <button
              className={
                shape === brushShape.value ? `${styles.tool} ${styles.toolActive}` : styles.tool
              }
              disabled={disabled}
              key={shape}
              onClick={() => {
                brushShape.value = shape;
              }}
              type="button"
            >
              {shape === "circle" ? "Round" : "Square"}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>
          Layer<span className={styles.value}>{Math.round(layerOpacity.value * 100)}%</span>
        </h2>
        <input
          disabled={disabled}
          max={100}
          min={10}
          onChange={(event) => {
            layerOpacity.value = Number(event.target.value) / 100;
          }}
          type="range"
          value={Math.round(layerOpacity.value * 100)}
        />
        <label className={styles.check}>
          <input
            checked={layerVisible.value}
            disabled={disabled}
            onChange={(event) => {
              layerVisible.value = event.target.checked;
            }}
            type="checkbox"
          />
          Provinces layer
        </label>
        <label className={styles.check}>
          <input
            checked={showBaseMap.value}
            disabled={disabled}
            onChange={(event) => {
              showBaseMap.value = event.target.checked;
            }}
            type="checkbox"
          />
          Base map
        </label>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>History</h2>
        <div className={styles.row}>
          <button disabled={!canUndo.value} onClick={undo} type="button">
            Undo
          </button>
          <button disabled={!canRedo.value} onClick={redo} type="button">
            Redo
          </button>
        </div>
        <button
          className={styles.danger}
          disabled={disabled}
          onClick={() => {
            if (window.confirm("Erase the whole provinces layer?")) {
              clearLayer();
            }
          }}
          type="button"
        >
          Clear layer
        </button>
      </section>
    </aside>
  );
}

export { Toolbar };
