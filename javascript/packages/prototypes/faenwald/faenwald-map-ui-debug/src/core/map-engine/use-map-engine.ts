import { RefObject, useEffect, useState } from 'react'
import { TProvince } from './map-types.ts'
import { EMapEngineEvent, MapEngine } from './map-engine.ts'

type THoverState = {
  province: TProvince;
  x: number;
  y: number;
} | null;

export function useMapEngine(canvasRef: RefObject<HTMLCanvasElement | null>) {
  const [selectedProvince, setSelectedProvince] = useState<TProvince | null>(null);
  const [hoveredProvince, setHoveredProvince] = useState<THoverState>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [_mapEngine, setMapEngine] = useState<MapEngine>();

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return;
    }

    const mapEngine = new MapEngine(canvas);

    setMapEngine(mapEngine);

    mapEngine.subscribeOnEvents((event) => {
      if (event === EMapEngineEvent.ASSETS_LOADED) {
        setIsLoading(false);
        return;
      }

      if (event === EMapEngineEvent.PROVINCE_SELECTED) {
        setSelectedProvince(mapEngine.selectedProvice);
        return;
      }

      if (event === EMapEngineEvent.PROVINCE_HOVERED) {
        const province = mapEngine.hoveredProvince;
        if (province) {
          const pos = mapEngine.hoverPosition;
          setHoveredProvince({ province, x: pos.x, y: pos.y });
        } else {
          setHoveredProvince(null);
        }
        return;
      }
    });

    return () => {
      mapEngine.destroy();
    }
  }, []);

  return { selectedProvince, hoveredProvince, isLoading, _mapEngine };
}
