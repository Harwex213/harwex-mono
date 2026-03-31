import { useRef } from "react";
import s from "./App.module.css";
import { useMapEngine } from "@/core/map-engine/useMapEngine.ts";

export const App = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { selectedProvince, isLoading } = useMapEngine(canvasRef)

  return (
    <div className={s.app}>
      {isLoading ? <div className={s.loader}>Loading...</div> : null}

      <canvas ref={canvasRef} className={s.canvas}/>

      {
        selectedProvince ? (
          <div className={s.provinceInfo}>
            <div className={s.provinceName}>{selectedProvince.provinceName}</div>
            <div className={s.provinceId}>{selectedProvince.provinceId}</div>
          </div>
        ) : null
      }
    </div>
  )
};
