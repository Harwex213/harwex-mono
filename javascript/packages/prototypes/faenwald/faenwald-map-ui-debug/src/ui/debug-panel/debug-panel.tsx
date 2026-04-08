import { type ChangeEventHandler, memo, useState } from "react";
import type { MapEngine } from "../../core/map-engine/map-engine";
import { isProvinceHaveCenter } from "../../core/map-engine/map-types";
import s from "./debug-panel.module.css";
import { not, useLocalStorageState } from "../../utils";

type TWithMapEngine = {
  mapEngine: MapEngine;
}

const DebugPanelDialog = memo<TWithMapEngine>(({ mapEngine }) => {
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

const DebugPanel = memo<TWithMapEngine>(({ mapEngine }) => {
  const [opened, setOpened] = useLocalStorageState(false, "DebugPanel");

  const toggleOpened = () => {
    setOpened((prev) => !prev);
  };

  return (
    <div className={s.container}>
      <button className={s.button} onClick={toggleOpened}>
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 18L20 18" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
          <path d="M4 12L20 12" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
          <path d="M4 6L20 6" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>

      {opened ? <DebugPanelDialog mapEngine={mapEngine}/> : null}
    </div>
  )
});

export { DebugPanel };
