import {
  createRandom,
  hashSeed,
  roughArrowPath,
  roughEllipsePath,
  roughRectPath,
} from "../excalidraw/rough";
import type { FC, ReactNode } from "react";
import type {
  TExcalidrawColor,
  TExcalidrawDocument,
  TExcalidrawPoint,
  TExcalidrawShape,
} from "../../api/types";

type TExcalidrawViewerProps = {
  document: TExcalidrawDocument;
};

const STROKE_BY_COLOR: Readonly<Record<TExcalidrawColor, string>> = {
  ink: "var(--sketch-ink)",
  blue: "var(--sketch-blue)",
  green: "var(--sketch-green)",
  orange: "var(--sketch-orange)",
  violet: "var(--sketch-violet)",
};

const FILL_BY_COLOR: Readonly<Record<TExcalidrawColor, string>> = {
  ink: "var(--sketch-ink-fill)",
  blue: "var(--sketch-blue-fill)",
  green: "var(--sketch-green-fill)",
  orange: "var(--sketch-orange-fill)",
  violet: "var(--sketch-violet-fill)",
};

const LABEL_SIZE = 15;

const TEXT_SIZE = {
  small: 13,
  medium: 17,
  large: 26,
};

const LABEL_GAP = 11;

type TArrowLabel = {
  x: number;
  y: number;
  anchor: "start" | "middle";
};

// A label sits beside a vertical segment and above a horizontal one, so it never
// covers the stroke or the shape the arrow points at.
const placeArrowLabel = (points: readonly TExcalidrawPoint[]): TArrowLabel | null => {
  const tip = points[points.length - 1];
  const previous = points[points.length - 2];
  if (tip === undefined || previous === undefined) {
    return null;
  }

  const centerX = (tip[0] + previous[0]) / 2;
  const centerY = (tip[1] + previous[1]) / 2;
  const isVertical = Math.abs(tip[1] - previous[1]) > Math.abs(tip[0] - previous[0]);

  if (isVertical) {
    return { x: centerX + LABEL_GAP, y: centerY, anchor: "start" };
  }

  return { x: centerX, y: centerY - LABEL_GAP, anchor: "middle" };
};

const renderShape = (shape: TExcalidrawShape, index: number): ReactNode => {
  const key = `${shape.type}-${index}`;
  const random = createRandom(hashSeed(`${key}-${JSON.stringify(shape)}`));
  const stroke = STROKE_BY_COLOR[shape.color];

  if (shape.type === "text") {
    return (
      <text
        className="sketch__text"
        fill={stroke}
        fontSize={TEXT_SIZE[shape.size]}
        key={key}
        x={shape.x}
        y={shape.y}
      >
        {shape.text}
      </text>
    );
  }

  if (shape.type === "arrow") {
    const label = shape.label === undefined
      ? null
      : placeArrowLabel(shape.points);

    return (
      <g key={key}>
        <path
          className="sketch__stroke"
          d={roughArrowPath(shape.points, random)}
          stroke={stroke}
        />
        {label === null ? null : (
          <text
            className="sketch__text"
            dominantBaseline="middle"
            fill={stroke}
            fontSize={13}
            textAnchor={label.anchor}
            x={label.x}
            y={label.y}
          >
            {shape.label}
          </text>
        )}
      </g>
    );
  }

  const path = shape.type === "rect"
    ? roughRectPath(shape.x, shape.y, shape.width, shape.height, random)
    : roughEllipsePath(shape.x, shape.y, shape.width, shape.height, random);

  return (
    <g key={key}>
      {shape.type === "rect" ? (
        <rect
          fill={FILL_BY_COLOR[shape.color]}
          height={shape.height}
          rx={6}
          width={shape.width}
          x={shape.x}
          y={shape.y}
        />
      ) : (
        <ellipse
          cx={shape.x + shape.width / 2}
          cy={shape.y + shape.height / 2}
          fill={FILL_BY_COLOR[shape.color]}
          rx={shape.width / 2}
          ry={shape.height / 2}
        />
      )}
      <path className="sketch__stroke" d={path} stroke={stroke} />
      {shape.label === undefined ? null : (
        <text
          className="sketch__text"
          dominantBaseline="middle"
          fill={stroke}
          fontSize={LABEL_SIZE}
          textAnchor="middle"
          x={shape.x + shape.width / 2}
          y={shape.y + shape.height / 2}
        >
          {shape.label}
        </text>
      )}
    </g>
  );
};

const ExcalidrawViewer: FC<TExcalidrawViewerProps> = ({ document }) => {
  return (
    <div className="sketch">
      <svg
        className="sketch__canvas"
        preserveAspectRatio="xMidYMid meet"
        viewBox={`0 0 ${document.width} ${document.height}`}
      >
        {document.shapes.map(renderShape)}
      </svg>
    </div>
  );
};

export { ExcalidrawViewer };
