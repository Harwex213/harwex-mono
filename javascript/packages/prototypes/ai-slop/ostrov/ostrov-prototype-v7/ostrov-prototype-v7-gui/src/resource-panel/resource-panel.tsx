import "./resource-panel.css";
import type { CSSProperties, ReactElement } from "react";

// A cell reads `normal` unless the caller marks it `positive`. The tone is data,
// never a comparison the widget makes on the value.
type ResourceTone = "normal" | "positive";

type ResourceItem = {
  id: string;
  icon: string;
  value: number;
  label: string;
  tone?: ResourceTone;
};

type ResourcePanelProps = {
  items: readonly ResourceItem[];
  columns?: number;
};

const defaultColumns = 4;

// The bar across the top of the board: one cell per resource, the caller's
// columns per row, the last row left aligned.
const ResourcePanel = ({
  items,
  columns = defaultColumns,
}: ResourcePanelProps): ReactElement => {
  const style = {
    "--ostrov-resources-columns": String(columns),
  } as CSSProperties;

  return (
    <div className="ostrov-resources" style={style}>
      <div className="ostrov-resources__grid">
        {items.map((item) => {
          const tone = item.tone ?? "normal";

          return (
            <div className="ostrov-resources__cell" key={item.id}>
              <span className="ostrov-resources__icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="ostrov-resources__text">
                <span
                  className={`ostrov-resources__value ostrov-resources__value--${tone}`}
                >
                  {item.value}
                </span>
                <span className="ostrov-resources__label">{item.label}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export { ResourcePanel };
export type { ResourceItem, ResourcePanelProps, ResourceTone };
