import { useRef } from "react";
import { useMapEngine } from "@/core/map-engine/useMapEngine.ts";
import s from "./App.module.css";

export const App = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { selectedProvince, hoveredProvince, isLoading } = useMapEngine(canvasRef);

  return (
    <div className={s.app}>
      {isLoading ? <div className={s.loader}>Loading...</div> : null}

      <canvas ref={canvasRef} className={s.canvas}/>

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
    </div>
  )
};
