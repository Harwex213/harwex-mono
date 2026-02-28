import { MAP_CONFIG } from "@/config/map";

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

function createCamera(): Camera {
  return { x: 0, y: 0, zoom: MAP_CONFIG.defaultZoom };
}

function clampCamera(camera: Camera): Camera {
  const { width, height, tileSize, minZoom, maxZoom } = MAP_CONFIG;
  const worldWidth = width * tileSize;
  const worldHeight = height * tileSize;

  const zoom = Math.min(maxZoom, Math.max(minZoom, camera.zoom));

  const maxX = 0;
  const maxY = 0;
  const minX = -(worldWidth * zoom - window.innerWidth);
  const minY = -(worldHeight * zoom - window.innerHeight);

  return {
    x: Math.min(maxX, Math.max(minX, camera.x)),
    y: Math.min(maxY, Math.max(minY, camera.y)),
    zoom,
  };
}

function screenToWorld(
  screenX: number,
  screenY: number,
  camera: Camera,
): { wx: number; wy: number } {
  return {
    wx: (screenX - camera.x) / camera.zoom,
    wy: (screenY - camera.y) / camera.zoom,
  };
}

export type { Camera };
export { createCamera, clampCamera, screenToWorld };
