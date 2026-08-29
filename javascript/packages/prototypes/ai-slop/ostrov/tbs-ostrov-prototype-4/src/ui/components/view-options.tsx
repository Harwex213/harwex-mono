import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { TSetHexSizeAction, TToggleViewOptionAction } from "../../domain/registry";
import type { TViewToggleKey } from "../../domain/view-state";
import type { ChangeEvent, FC } from "react";

type TViewOptionsRegistrySlice = {
  toggleViewOptionAction: TToggleViewOptionAction;
  setHexSizeAction: TSetHexSizeAction;
};

type TViewOptionsProps = {
  registry: TViewOptionsRegistrySlice;
};

const TOGGLES: readonly { key: TViewToggleKey; label: string }[] = [
  { key: "showGrid", label: "Сетка" },
  { key: "showFog", label: "Туман войны" },
  { key: "showCoords", label: "Координаты q,r" },
];

const ViewOptions: FC<TViewOptionsProps> = ({ registry }) => {
  useSignals();
  const store = useStore();

  const hexSize = store.viewState.hexSize.value;

  const handleSize = (event: ChangeEvent<HTMLInputElement>) => {
    registry.setHexSizeAction(Number(event.target.value));
  };

  return (
    <section className="panel">
      <h2 className="panel__title">
        {"Вид"}
      </h2>

      <ul className="toggles">
        {TOGGLES.map(({ key, label }) => (
          <li key={key}>
            <label className="toggle">
              <input
                type="checkbox"
                checked={store.viewState[key].value}
                onChange={() => registry.toggleViewOptionAction(key)}
              />
              <span>
                {label}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <label className="field">
        <span className="field__label">
          {`Размер клетки: ${hexSize}`}
        </span>
        <input className="field__range" type="range" min={16} max={64} step={2} value={hexSize} onChange={handleSize} />
      </label>
    </section>
  );
};

export { ViewOptions };
