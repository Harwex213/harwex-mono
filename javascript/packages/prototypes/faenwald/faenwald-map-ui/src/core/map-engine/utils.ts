import { TProvincesMap } from "@/core/map-engine/types.ts";

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function loadProvinces(): Promise<TProvincesMap> {
  const res = await fetch('/assets/provinces.json');
  return res.json();
}

export function getPixelHex(data: Uint8ClampedArray, x: number, y: number, width: number): string {
  const i = (y * width + x) * 4;
  const r = data[i].toString(16).padStart(2, '0')
  const g = data[i + 1].toString(16).padStart(2, '0')
  const b = data[i + 2].toString(16).padStart(2, '0')
  return `#${r}${g}${b}`;
}
