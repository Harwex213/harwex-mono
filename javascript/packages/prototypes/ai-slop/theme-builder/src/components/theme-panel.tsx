import type { ReactNode } from "react";
import { FONT_STACKS, THEME_PRESETS } from "../data/theme";
import { useEditor } from "../store/editor-context";
import type { PropField } from "../types";
import { PropControl } from "./fields";

const COLOR_FIELDS: PropField[] = [
  { key: "brand", label: "Brand", type: "color", hint: "Buttons and odds" },
  { key: "accent", label: "Accent", type: "color", hint: "Boosts and promos" },
  { key: "base", label: "Page background", type: "color" },
  { key: "surface", label: "Card surface", type: "color" },
  { key: "text", label: "Text", type: "color" },
  { key: "muted", label: "Muted text", type: "color" },
];

const SHAPE_FIELDS: PropField[] = [
  { key: "radius", label: "Corner radius", type: "range", min: 0, max: 24, step: 1 },
  { key: "density", label: "Density", type: "range", min: 0.7, max: 1.4, step: 0.05, hint: "Padding multiplier" },
  {
    key: "fontFamily",
    label: "Typeface",
    type: "select",
    options: Object.keys(FONT_STACKS).map((key) => ({ value: key, label: key })),
  },
];

function ThemePanel(): ReactNode {
  const { state, dispatch } = useEditor();
  const theme = state.doc.theme;

  return (
    <div className="tb-panel">
      <div className="tb-panel__head">
        <span className="tb-panel__title">Theme</span>
      </div>

      <div className="tb-group">
        <div className="tb-group__title">Presets</div>
        <div className="tb-presets">
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="tb-presets__item"
              onClick={() => dispatch({ type: "update-theme", patch: preset.tokens })}
            >
              <span className="tb-presets__swatches">
                {[preset.tokens.base, preset.tokens.surface, preset.tokens.brand, preset.tokens.accent].map((color) => (
                  <span key={color} style={{ background: color }} />
                ))}
              </span>
              <span className="tb-presets__label">{preset.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="tb-group">
        <div className="tb-group__title">Colours</div>
        {COLOR_FIELDS.map((field) => (
          <PropControl
            key={field.key}
            field={field}
            value={theme[field.key as keyof typeof theme]}
            onChange={(value) => dispatch({ type: "update-theme", patch: { [field.key]: value } })}
          />
        ))}
      </div>

      <div className="tb-group">
        <div className="tb-group__title">Shape and type</div>
        {SHAPE_FIELDS.map((field) => (
          <PropControl
            key={field.key}
            field={field}
            value={theme[field.key as keyof typeof theme]}
            onChange={(value) => dispatch({ type: "update-theme", patch: { [field.key]: value } })}
          />
        ))}
      </div>

      <p className="tb-panel__note">Theme tokens apply to every page and every widget on the canvas.</p>
    </div>
  );
}

export { ThemePanel };
