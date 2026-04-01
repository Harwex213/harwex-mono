import type { TProvince } from "@hw/faenwald-core";
import { RefObject, useEffect, useState } from 'react';
import { EMapEngineEvent, MapEngine } from './map-engine.js';

type THoverState = {
  province: TProvince;
  x: number;
  y: number;
} | null;

const mapCanvas = document.createElement('canvas');
mapCanvas.style.display = "block";
mapCanvas.style.width = "100%";
mapCanvas.style.height = "100%";
mapCanvas.style.cursor = "grab";
const mapEngine = new MapEngine(mapCanvas);

export function useMapEngine(containerRef: RefObject<HTMLDivElement | null>) {
  const [selectedProvince, setSelectedProvince] = useState<TProvince | null>(null);
  const [hoveredProvince, setHoveredProvince] = useState<THoverState>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [_mapEngine, setMapEngine] = useState<MapEngine>();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    container.appendChild(mapCanvas);

    setMapEngine(mapEngine);

    const handleEvent = (event: EMapEngineEvent) => {
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
    };

    mapEngine.subscribeOnEvents(handleEvent);

    return () => {
      container.removeChild(mapCanvas);
      mapEngine.unsubscribeFromEvents(handleEvent);
    }
  }, []);

  return { selectedProvince, hoveredProvince, isLoading, _mapEngine };
}
