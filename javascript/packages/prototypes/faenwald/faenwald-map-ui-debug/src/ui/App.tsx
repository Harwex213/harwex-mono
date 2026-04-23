import { useRef } from "react";
import { useMapEngine } from "../core/map-engine/use-map-engine.js";
import s from "./App.module.css";
import { DebugPanel } from "./debug-panel/debug-panel";
import { EventTimeline } from "./event-timeline/event-timeline";

export const App = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { selectedProvince, selectedArmy, hoveredProvince, isLoading, _mapEngine } = useMapEngine(containerRef);

  return (
    <div className={s.app}>
      {isLoading ? <div className={s.loader}>Loading...</div> : null}

      <div ref={containerRef} className={s.canvas}/>

      {
        selectedProvince ? (
          <div className={s.selectedProvince}>
            <div className={s.provinceName}>{selectedProvince.provinceName}</div>
            <div className={s.provinceId}>{selectedProvince.provinceId}</div>
          </div>
        ) : null
      }

      {
        hoveredProvince ? (
          <div className={s.hoveredProvince}>
            <div className={s.provinceName}>{hoveredProvince.province.provinceName}</div>
            <div className={s.provinceId}>{hoveredProvince.province.provinceId}</div>
          </div>
        ) : null
      }

      {
        selectedArmy ? (
          <div className={s.selectedArmy}>
            <div className={s.provinceName}>{selectedArmy.provinceId}</div>
            <div className={s.provinceName}>{selectedArmy.name}</div>
            <div className={s.provinceId}>{selectedArmy.units.map((unit, i) => (
              <div key={i}>
                {`${unit.type} - ${unit.amount} - ${unit.rank}`}
              </div>
            ))}</div>
          </div>
        ) : null
      }

      {
        !isLoading && _mapEngine ? (
          <>
            <DebugPanel mapEngine={_mapEngine}/>
            <EventTimeline mapEngine={_mapEngine}/>
          </>
        ) : null
      }
    </div>
  )
};
