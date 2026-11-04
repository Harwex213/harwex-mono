import { useSignals } from "@preact/signals-react/runtime";
import type { TAppRegistry } from "../../../actions/index";
import {
  MAX_SIZE,
  MIN_SIZE,
  type Tool,
} from "../../../domain/index";
import { useStore } from "../../../store/index";
import styles from "./toolbar.module.css";

type TToolbarProps = {
  registry: Pick<
    TAppRegistry,
    | "clearLayer"
    | "fitToViewport"
    | "redo"
    | "setBrushShape"
    | "setBrushSize"
    | "setLayerOpacity"
    | "setLayerVisible"
    | "setShowBaseMap"
    | "setTool"
    | "undo"
  >;
};

const TOOLS: Array<{ id: Tool; label: string; hint: string }> = [
  { id: "brush", label: "Brush", hint: "B — freehand paint with the active province" },
  { id: "bucket", label: "Bucket", hint: "G — fill the area under the cursor up to your strokes" },
  { id: "eraser", label: "Eraser", hint: "E — clear paint (or hold the right mouse button)" },
  { id: "picker", label: "Picker", hint: "I — make the province under the cursor active" },
];

const SIZE_PRESETS = [1, 4, 12, 32, 64];

// The left menu. The provinces mode shows the cursor modes, the brush and the
// history. The countries mode has one thing a click does, so it shows only the
// view and the layer.
function Toolbar({ registry }: TToolbarProps) {
  useSignals();

  const store = useStore();
  const tools = store.tools;
  const disabled = store.map.info.value === null;
  const provincesMode = tools.mode.value === "provinces";

  return (
    <aside className={styles.panel}>
      {provincesMode && (
        <section className={styles.section}>
          <h2 className={styles.heading}>Cursor Mode</h2>
          <div className={styles.tools}>
            {TOOLS.map((entry) => (
              <button
                className={entry.id === tools.tool.value ? `${styles.tool} ${styles.toolActive}` : styles.tool}
                disabled={disabled}
                key={entry.id}
                onClick={() => {
                  registry.setTool(entry.id);
                }}
                title={entry.hint}
                type="button"
              >
                {entry.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {provincesMode && (
        <section className={styles.section}>
          <h2 className={styles.heading}>
            Brush<span className={styles.value}>{tools.brushSize.value} px</span>
          </h2>
          <input
            disabled={disabled}
            max={MAX_SIZE}
            min={MIN_SIZE}
            onChange={(event) => {
              registry.setBrushSize(Number(event.target.value));
            }}
            type="range"
            value={tools.brushSize.value}
          />
          <div className={styles.presets}>
            {SIZE_PRESETS.map((size) => (
              <button
                className={styles.preset}
                disabled={disabled}
                key={size}
                onClick={() => {
                  registry.setBrushSize(size);
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
                  shape === tools.brushShape.value ? `${styles.tool} ${styles.toolActive}` : styles.tool
                }
                disabled={disabled}
                key={shape}
                onClick={() => {
                  registry.setBrushShape(shape);
                }}
                type="button"
              >
                {shape === "circle" ? "Round" : "Square"}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.heading}>View</h2>
        <button
          disabled={disabled}
          onClick={() => {
            registry.fitToViewport();
          }}
          title="0 — fit the whole map into the window"
          type="button"
        >
          Fit
        </button>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>
          Layer<span className={styles.value}>{Math.round(tools.layerOpacity.value * 100)}%</span>
        </h2>
        <input
          disabled={disabled}
          max={100}
          min={10}
          onChange={(event) => {
            registry.setLayerOpacity(Number(event.target.value) / 100);
          }}
          type="range"
          value={Math.round(tools.layerOpacity.value * 100)}
        />
        <label className={styles.check}>
          <input
            checked={tools.layerVisible.value}
            disabled={disabled}
            onChange={(event) => {
              registry.setLayerVisible(event.target.checked);
            }}
            type="checkbox"
          />
          {provincesMode ? "Provinces layer" : "Countries layer"}
        </label>
        <label className={styles.check}>
          <input
            checked={tools.showBaseMap.value}
            disabled={disabled}
            onChange={(event) => {
              registry.setShowBaseMap(event.target.checked);
            }}
            type="checkbox"
          />
          Base map
        </label>
      </section>

      {provincesMode && (
        <section className={styles.section}>
          <h2 className={styles.heading}>History</h2>
          <div className={styles.row}>
            <button
              disabled={!store.map.canUndo.value}
              onClick={() => {
                registry.undo();
              }}
              type="button"
            >
              Undo
            </button>
            <button
              disabled={!store.map.canRedo.value}
              onClick={() => {
                registry.redo();
              }}
              type="button"
            >
              Redo
            </button>
          </div>
          <button
            className={styles.danger}
            disabled={disabled}
            onClick={() => {
              if (window.confirm("Erase the whole provinces layer?")) {
                registry.clearLayer();
              }
            }}
            type="button"
          >
            Clear layer
          </button>
        </section>
      )}
    </aside>
  );
}

export { Toolbar };
