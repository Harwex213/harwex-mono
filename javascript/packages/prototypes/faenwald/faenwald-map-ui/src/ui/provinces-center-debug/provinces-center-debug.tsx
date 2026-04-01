import { memo, useState } from "react";
import type { MapEngine } from "../../core/map-engine/map-engine";
import { isProvinceHaveCenter } from "../../core/map-engine/map-types";
import s from "./provinces-center-debug.module.css";
import { not } from "../../utils";

type TWithMapEngine = {
  mapEngine: MapEngine;
}

const ProvincesCenterDebug = memo<TWithMapEngine>(({ mapEngine }) => {
  const [checked, setState] = useState(mapEngine.isRenderingProvinceCenters);

  const handleChange = () => {
    mapEngine.toggleRenderProvinceCenters();
    setState(mapEngine.isRenderingProvinceCenters);
  }

  return (
    <div className={s.content}>
      <div className={s.isRenderingProvinceCenters}>
        <input type="checkbox" id="isRenderingProvinceCenters" checked={checked} onChange={handleChange}/>
        <label htmlFor="isRenderingProvinceCenters">isRenderingProvinceCenters</label>
      </div>

      <div className={s.list}>
        {
          mapEngine.provincesArray.filter(not(isProvinceHaveCenter)).map((province) => (
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
    </div>
  )
});

export { ProvincesCenterDebug };
