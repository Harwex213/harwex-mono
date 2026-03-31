import { memo } from "react";
import type { MapEngine } from "../../core/map-engine/map-engine";
import { isProvinceHaveCenter } from "../../core/map-engine/map";
import s from "./provinces-center-debug.module.css";
import { not } from "../../utils";

type TProvincesCenterDebugProps = {
  mapEngine: MapEngine;
}

const ProvincesCenterDebug = memo<TProvincesCenterDebugProps>(({ mapEngine }) => {
  const provinces = mapEngine.provincesCopy;

  console.log(provinces);

  return (
    <div className={s.list}>
      {
        provinces.filter(not(isProvinceHaveCenter)).map((province) => (
          <button className={s.item} key={province.provinceId}>
            <p>
              {province.provinceName}
            </p>

            <p>
              {province.provinceId}
            </p>
          </button>
        ))
      }
    </div>
  )
});

export { ProvincesCenterDebug };
