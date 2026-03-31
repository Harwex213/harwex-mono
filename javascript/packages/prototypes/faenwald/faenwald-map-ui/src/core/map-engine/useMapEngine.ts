import { RefObject, useEffect, useState } from 'react'
import { TProvince } from './types.ts'
import { EMapEngineEvent, MapEngine } from './map-engine.ts'

export function useMapEngine(canvasRef: RefObject<HTMLCanvasElement | null>) {
  const [selectedProvince, setSelectedProvince] = useState<TProvince | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return;
    }

    const mapEngine = new MapEngine(canvas);

    mapEngine.subscribeOnEvents((event) => {
      if (event === EMapEngineEvent.ASSETS_LOADED) {
        setIsLoading(false);
        return;
      }

      if (event === EMapEngineEvent.PROVINCE_SELECTED) {
        setSelectedProvince(mapEngine.selectedProvice);
        return;
      }
    });

    return () => {
      mapEngine.destroy();
    }
  }, []);

  return { selectedProvince, isLoading }
}
