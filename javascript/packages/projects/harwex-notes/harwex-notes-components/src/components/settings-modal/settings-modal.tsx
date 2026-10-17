import "./settings-modal.css";
import { EXCALIDRAW_DEFAULT_STYLE_SETTING } from "@hw/harwex-notes-protocol";
import { useEffect, useId, useRef } from "react";
import type { FC, KeyboardEvent, ReactNode } from "react";
import type { TExcalidrawStyle } from "@hw/harwex-notes-protocol";
import type { TSettingsModalProps } from "./settings-modal.types";

type TDrawingStyle = Required<TExcalidrawStyle>;

type TOption<TValue> = {
  value: TValue;
  label: string;
};

// The same five picks Excalidraw offers first in its own colour pickers.
const STROKE_COLORS: readonly TOption<string>[] = [
  { value: "#1e1e1e", label: "Black" },
  { value: "#e03131", label: "Red" },
  { value: "#2f9e44", label: "Green" },
  { value: "#1971c2", label: "Blue" },
  { value: "#f08c00", label: "Orange" },
];

const BACKGROUND_COLORS: readonly TOption<string>[] = [
  { value: "transparent", label: "Transparent" },
  { value: "#ffc9c9", label: "Light red" },
  { value: "#b2f2bb", label: "Light green" },
  { value: "#a5d8ff", label: "Light blue" },
  { value: "#ffec99", label: "Light yellow" },
];

const FILL_STYLES: readonly TOption<string>[] = [
  { value: "hachure", label: "Hachure" },
  { value: "cross-hatch", label: "Cross-hatch" },
  { value: "solid", label: "Solid" },
];

const STROKE_WIDTHS: readonly TOption<number>[] = [
  { value: 1, label: "Thin" },
  { value: 2, label: "Bold" },
  { value: 4, label: "Extra bold" },
];

const STROKE_STYLES: readonly TOption<string>[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];

// Excalidraw calls roughness "sloppiness" and names its three steps.
const ROUGHNESS: readonly TOption<number>[] = [
  { value: 0, label: "Architect" },
  { value: 1, label: "Artist" },
  { value: 2, label: "Cartoonist" },
];

const ROUNDNESS: readonly TOption<string>[] = [
  { value: "sharp", label: "Sharp" },
  { value: "round", label: "Round" },
];

const ARROW_TYPES: readonly TOption<string>[] = [
  { value: "sharp", label: "Straight" },
  { value: "round", label: "Curved" },
  { value: "elbow", label: "Elbow" },
];

// The value is a string so a select can carry it; "none" stands for a null arrowhead.
const ARROWHEADS: readonly TOption<string>[] = [
  { value: "none", label: "None" },
  { value: "arrow", label: "Arrow" },
  { value: "triangle", label: "Triangle" },
  { value: "triangle_outline", label: "Triangle outline" },
  { value: "bar", label: "Bar" },
  { value: "dot", label: "Dot" },
  { value: "circle_outline", label: "Circle outline" },
  { value: "diamond", label: "Diamond" },
  { value: "diamond_outline", label: "Diamond outline" },
];

// Excalidraw's own font ids: 5 is Excalifont, 6 is Nunito, 8 is Comic Shanns.
const FONT_FAMILIES: readonly TOption<number>[] = [
  { value: 5, label: "Hand-drawn" },
  { value: 6, label: "Normal" },
  { value: 8, label: "Code" },
];

const FONT_CSS_BY_ID: Readonly<Record<number, string>> = {
  5: "Excalifont, \"Comic Sans MS\", cursive",
  6: "Nunito, system-ui, sans-serif",
  8: "\"Comic Shanns\", ui-monospace, monospace",
};

const FONT_SIZES: readonly TOption<number>[] = [
  { value: 16, label: "S" },
  { value: 20, label: "M" },
  { value: 28, label: "L" },
  { value: 36, label: "XL" },
];

const TEXT_ALIGNS: readonly TOption<string>[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

const DASH_BY_STROKE_STYLE: Readonly<Record<string, string | undefined>> = {
  solid: undefined,
  dashed: "8 6",
  dotted: "1.5 5",
};

const PREVIEW_TEXT_SCALE = 0.75;

type TFieldProps = {
  label: string;
  children: ReactNode;
};

const Field: FC<TFieldProps> = ({ label, children }) => {
  return (
    <div className="settings-modal__field">
      <span className="settings-modal__label">{label}</span>
      <div className="settings-modal__control">{children}</div>
    </div>
  );
};

type TSegmentedProps<TValue> = {
  label: string;
  options: readonly TOption<TValue>[];
  value: TValue;
  onChange: (value: TValue) => void;
};

const Segmented = <TValue extends string | number>({ label, options, value, onChange }: TSegmentedProps<TValue>) => {
  return (
    <div aria-label={label} className="settings-modal__segmented" role="radiogroup">
      {options.map((option) => {
        const isActive = option.value === value;

        return (
          <button
            aria-checked={isActive}
            className={`settings-modal__segment${isActive ? " settings-modal__segment--active" : ""}`}
            key={String(option.value)}
            onClick={() => onChange(option.value)}
            role="radio"
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

type TSwatchesProps = {
  label: string;
  options: readonly TOption<string>[];
  value: string;
  onChange: (value: string) => void;
};

// Five fixed picks plus a native picker for any other colour. The active swatch carries a
// ring as well as its colour (FEED-5).
const Swatches: FC<TSwatchesProps> = ({ label, options, value, onChange }) => {
  const isCustom = !options.some((option) => option.value === value);

  return (
    <div aria-label={label} className="settings-modal__swatches" role="radiogroup">
      {options.map((option) => {
        const isActive = option.value === value;
        const isTransparent = option.value === "transparent";

        return (
          <button
            aria-checked={isActive}
            aria-label={option.label}
            className={`settings-modal__swatch${isActive ? " settings-modal__swatch--active" : ""}${isTransparent ? " settings-modal__swatch--transparent" : ""}`}
            key={option.value}
            onClick={() => onChange(option.value)}
            role="radio"
            style={isTransparent ? undefined : { background: option.value }}
            title={option.label}
            type="button"
          />
        );
      })}

      <label
        className={`settings-modal__swatch settings-modal__swatch--custom${isCustom ? " settings-modal__swatch--active" : ""}`}
        style={isCustom ? { background: value } : undefined}
        title={"Another colour"}
      >
        <input
          aria-label={`${label}: another colour`}
          className="settings-modal__color-input"
          onChange={(event) => onChange(event.target.value)}
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
        />
      </label>
    </div>
  );
};

type TPreviewProps = {
  style: TDrawingStyle;
};

const readArrowheadPath = (kind: string | null, x: number, y: number, direction: 1 | -1): ReactNode => {
  if (kind === null) {
    return null;
  }

  const back = x - direction * 10;

  if (kind === "bar") {
    return <path d={`M ${x} ${y - 7} L ${x} ${y + 7}`} />;
  }

  if (kind.startsWith("dot") || kind.startsWith("circle")) {
    return <circle cx={x - direction * 4} cy={y} fill={kind === "circle_outline" ? "none" : "currentColor"} r={4} />;
  }

  if (kind.startsWith("diamond")) {
    const middle = x - direction * 7;

    return (
      <path
        d={`M ${x} ${y} L ${middle} ${y - 5} L ${x - direction * 14} ${y} L ${middle} ${y + 5} Z`}
        fill={kind === "diamond_outline" ? "none" : "currentColor"}
      />
    );
  }

  if (kind.startsWith("triangle")) {
    return (
      <path
        d={`M ${x} ${y} L ${back} ${y - 6} L ${back} ${y + 6} Z`}
        fill={kind === "triangle_outline" ? "none" : "currentColor"}
      />
    );
  }

  return <path d={`M ${back} ${y - 7} L ${x} ${y} L ${back} ${y + 7}`} fill={"none"} />;
};

const readArrowPath = (arrowType: string): string => {
  if (arrowType === "elbow") {
    return "M 150 46 L 185 46 L 185 96 L 222 96";
  }

  if (arrowType === "round") {
    return "M 150 46 C 190 46, 182 96, 222 96";
  }

  return "M 150 46 L 222 96";
};

// A small picture of what a new drawing looks like: a box, an arrow and a line of text, in
// the chosen style. It approximates Excalidraw's rendering; it does not reproduce it.
const Preview: FC<TPreviewProps> = ({ style }) => {
  const patternId = useId();
  const dash = DASH_BY_STROKE_STYLE[style.currentItemStrokeStyle];
  const radius = style.currentItemRoundness === "round" ? 12 : 0;
  const hasFill = style.currentItemBackgroundColor !== "transparent";
  const fill = !hasFill ? "none" : style.currentItemFillStyle === "solid" ? style.currentItemBackgroundColor : `url(#${patternId})`;
  const textAnchor = style.currentItemTextAlign === "center" ? "middle" : style.currentItemTextAlign === "right" ? "end" : "start";
  const textX = textAnchor === "middle" ? 130 : textAnchor === "end" ? 248 : 12;
  const roughness = style.currentItemRoughness;

  return (
    <svg
      aria-label={"Preview of a new drawing"}
      className="settings-modal__preview"
      role="img"
      style={{ color: style.currentItemStrokeColor, opacity: style.currentItemOpacity / 100 }}
      viewBox={"0 0 260 150"}
    >
      <defs>
        <pattern
          height={8}
          id={patternId}
          patternTransform={"rotate(-41)"}
          patternUnits={"userSpaceOnUse"}
          width={8}
        >
          <rect fill={style.currentItemBackgroundColor} height={8} opacity={0.35} width={8} />
          <path d={"M 0 4 L 8 4"} stroke={style.currentItemBackgroundColor} strokeWidth={2} />
          {style.currentItemFillStyle === "cross-hatch" ? (
            <path d={"M 4 0 L 4 8"} stroke={style.currentItemBackgroundColor} strokeWidth={2} />
          ) : null}
        </pattern>
      </defs>

      <g fill={"none"} stroke={"currentColor"} strokeDasharray={dash} strokeLinecap={"round"} strokeWidth={style.currentItemStrokeWidth}>
        <rect fill={fill} height={60} rx={radius} width={110} x={30 + roughness} y={16 - roughness} />
        {roughness > 0 ? <rect height={60} opacity={0.6} rx={radius} width={110} x={29 - roughness} y={17 + roughness} /> : null}
        <path d={readArrowPath(style.currentItemArrowType)} />
      </g>

      <g fill={"currentColor"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={style.currentItemStrokeWidth}>
        {readArrowheadPath(style.currentItemEndArrowhead, 222, 96, 1)}
        {readArrowheadPath(style.currentItemStartArrowhead, 150, 46, -1)}
      </g>

      <text
        fill={"currentColor"}
        fontFamily={FONT_CSS_BY_ID[style.currentItemFontFamily] ?? "system-ui, sans-serif"}
        fontSize={style.currentItemFontSize * PREVIEW_TEXT_SCALE}
        textAnchor={textAnchor}
        x={textX}
        y={136}
      >
        {"Text looks like this"}
      </text>
    </svg>
  );
};

// App settings (SET). Today it holds one group: the style of new drawings. A change is
// saved at once; there is no apply button. Escape, the close button and a click on the
// backdrop all close it.
const SettingsModal: FC<TSettingsModalProps> = ({
  isOpen,
  drawingStyle,
  isDrawingStyleCustom,
  registry,
  onClose,
}) => {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      closeRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const change = <TKey extends keyof TDrawingStyle>(key: TKey, value: TDrawingStyle[TKey]) => {
    registry.setSettingAction(EXCALIDRAW_DEFAULT_STYLE_SETTING, { ...drawingStyle, [key]: value });
  };

  const reset = () => {
    registry.setSettingAction(EXCALIDRAW_DEFAULT_STYLE_SETTING, null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className="settings-modal"
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div aria-labelledby={titleId} aria-modal={true} className="settings-modal__panel" role="dialog">
        <div className="settings-modal__header">
          <h2 className="settings-modal__title" id={titleId}>
            {"Settings"}
          </h2>

          <button
            aria-label={"Close settings"}
            className="settings-modal__close"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            {"×"}
          </button>
        </div>

        <section className="settings-modal__section">
          <div className="settings-modal__section-header">
            <h3 className="settings-modal__section-title">{"New drawings"}</h3>
            <p className="settings-modal__hint">
              {"The style a new drawing starts with. Drawings that already exist keep their own style."}
            </p>
          </div>

          <div className="settings-modal__body">
            <div className="settings-modal__fields">
              <Field label={"Stroke"}>
                <Swatches
                  label={"Stroke"}
                  onChange={(value) => change("currentItemStrokeColor", value)}
                  options={STROKE_COLORS}
                  value={drawingStyle.currentItemStrokeColor}
                />
              </Field>

              <Field label={"Background"}>
                <Swatches
                  label={"Background"}
                  onChange={(value) => change("currentItemBackgroundColor", value)}
                  options={BACKGROUND_COLORS}
                  value={drawingStyle.currentItemBackgroundColor}
                />
              </Field>

              <Field label={"Fill"}>
                <Segmented
                  label={"Fill"}
                  onChange={(value) => change("currentItemFillStyle", value)}
                  options={FILL_STYLES}
                  value={drawingStyle.currentItemFillStyle}
                />
              </Field>

              <Field label={"Stroke width"}>
                <Segmented
                  label={"Stroke width"}
                  onChange={(value) => change("currentItemStrokeWidth", value)}
                  options={STROKE_WIDTHS}
                  value={drawingStyle.currentItemStrokeWidth}
                />
              </Field>

              <Field label={"Stroke style"}>
                <Segmented
                  label={"Stroke style"}
                  onChange={(value) => change("currentItemStrokeStyle", value)}
                  options={STROKE_STYLES}
                  value={drawingStyle.currentItemStrokeStyle}
                />
              </Field>

              <Field label={"Sloppiness"}>
                <Segmented
                  label={"Sloppiness"}
                  onChange={(value) => change("currentItemRoughness", value)}
                  options={ROUGHNESS}
                  value={drawingStyle.currentItemRoughness}
                />
              </Field>

              <Field label={"Edges"}>
                <Segmented
                  label={"Edges"}
                  onChange={(value) => change("currentItemRoundness", value)}
                  options={ROUNDNESS}
                  value={drawingStyle.currentItemRoundness}
                />
              </Field>

              <Field label={"Arrow type"}>
                <Segmented
                  label={"Arrow type"}
                  onChange={(value) => change("currentItemArrowType", value)}
                  options={ARROW_TYPES}
                  value={drawingStyle.currentItemArrowType}
                />
              </Field>

              <Field label={"Arrowheads"}>
                <div className="settings-modal__pair">
                  <select
                    aria-label={"Start arrowhead"}
                    className="settings-modal__select"
                    onChange={(event) => {
                      change("currentItemStartArrowhead", event.target.value === "none" ? null : event.target.value);
                    }}
                    value={drawingStyle.currentItemStartArrowhead ?? "none"}
                  >
                    {ARROWHEADS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {`Start: ${option.label}`}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label={"End arrowhead"}
                    className="settings-modal__select"
                    onChange={(event) => {
                      change("currentItemEndArrowhead", event.target.value === "none" ? null : event.target.value);
                    }}
                    value={drawingStyle.currentItemEndArrowhead ?? "none"}
                  >
                    {ARROWHEADS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {`End: ${option.label}`}
                      </option>
                    ))}
                  </select>
                </div>
              </Field>

              <Field label={"Font"}>
                <Segmented
                  label={"Font"}
                  onChange={(value) => change("currentItemFontFamily", value)}
                  options={FONT_FAMILIES}
                  value={drawingStyle.currentItemFontFamily}
                />
              </Field>

              <Field label={"Font size"}>
                <Segmented
                  label={"Font size"}
                  onChange={(value) => change("currentItemFontSize", value)}
                  options={FONT_SIZES}
                  value={drawingStyle.currentItemFontSize}
                />
              </Field>

              <Field label={"Text align"}>
                <Segmented
                  label={"Text align"}
                  onChange={(value) => change("currentItemTextAlign", value)}
                  options={TEXT_ALIGNS}
                  value={drawingStyle.currentItemTextAlign}
                />
              </Field>

              <Field label={"Opacity"}>
                <div className="settings-modal__pair">
                  <input
                    aria-label={"Opacity"}
                    className="settings-modal__range"
                    max={100}
                    min={0}
                    onChange={(event) => change("currentItemOpacity", Number(event.target.value))}
                    step={10}
                    type="range"
                    value={drawingStyle.currentItemOpacity}
                  />
                  <span className="settings-modal__value">{`${drawingStyle.currentItemOpacity}%`}</span>
                </div>
              </Field>
            </div>

            <div className="settings-modal__aside">
              <Preview style={drawingStyle} />

              <button
                className="settings-modal__reset"
                disabled={!isDrawingStyleCustom}
                onClick={reset}
                type="button"
              >
                {"Reset to the app's style"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export { SettingsModal };
