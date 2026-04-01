import { type ChangeEventHandler, memo, useState } from "react";
import type { MapEngine } from "../../core/map-engine/map-engine";
import { isProvinceHaveCenter } from "../../core/map-engine/map-types";
import s from "./provinces-center-debug.module.css";
import { not, useLocalStorageState } from "../../utils";

type TWithMapEngine = {
  mapEngine: MapEngine;
}

const ProvincesCenterDebug = memo<TWithMapEngine>(({ mapEngine }) => {
  const [checked, setState] = useState(mapEngine.isRenderingProvinceCenters);
  const [turn, setTurn] = useLocalStorageState("4", "turn");
  const [phase, setPhase] = useLocalStorageState("2", "phase");

  const toggleRenderProvinceCenters = () => {
    mapEngine.toggleRenderProvinceCenters();
    setState(mapEngine.isRenderingProvinceCenters);
  };

  const handleChangeTurn: ChangeEventHandler<HTMLInputElement> = (e) => {
    setTurn(e.target.value);
  };
  const handleChangePhase: ChangeEventHandler<HTMLInputElement> = (e) => {
    setPhase(e.target.value);
  };

  return (
    <div className={s.content}>
      <form className={s.form}>
        <div className={s.checkbox}>
          <input
            type="checkbox"
            id="isRenderingProvinceCenters"
            checked={checked}
            onChange={toggleRenderProvinceCenters}
          />
          <label htmlFor="isRenderingProvinceCenters">isRenderingProvinceCenters</label>
        </div>

        <div className={s.input}>
          <input id="turn" value={turn} onChange={handleChangeTurn}/>
          <label htmlFor="turn">Turn</label>
        </div>

        <div className={s.input}>
          <input id="phase" value={phase} onChange={handleChangePhase}/>
          <label htmlFor="phase">Phase</label>
        </div>
      </form>

      <div className={s.list}>
        {
          mapEngine.provinces.filter(not(isProvinceHaveCenter)).map((province) => (
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
