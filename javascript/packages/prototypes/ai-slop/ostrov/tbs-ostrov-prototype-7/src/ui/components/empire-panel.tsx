import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TAsset } from "../../domain/tech/empire";

type TAssetListProps = {
  title: string;
  assets: TAsset[];
};

const AssetList: FC<TAssetListProps> = ({ title, assets }) => (
  <div className="assets">
    <h3 className="assets__title">
      {title}

      <span className="assets__count">
        {assets.length}
      </span>
    </h3>

    {assets.length === 0 ? (
      <p className="panel__hint">
        {"Пока ничего"}
      </p>
    ) : (
      <ul className="assets__list">
        {assets.map((asset) => (
          <li key={asset.name} className="asset" title={asset.notes.join("\n")}>
            <span className="asset__name">
              {asset.name}
            </span>

            <span className="asset__level">
              {`ур. ${asset.level}`}
            </span>
          </li>
        ))}
      </ul>
    )}
  </div>
);

const EmpirePanel = () => {
  useSignals();
  const store = useStore();
  const empire = store.techState.empire.value;

  return (
    <section className="panel">
      <h2 className="panel__title">
        {"Доступно к постройке"}
      </h2>

      <AssetList title="Постройки" assets={empire.buildings} />

      <AssetList title="Юниты" assets={empire.units} />
    </section>
  );
};

export { EmpirePanel };
