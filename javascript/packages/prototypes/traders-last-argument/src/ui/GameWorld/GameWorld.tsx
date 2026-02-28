import { useEffect, useRef } from "react";
import { generateMap } from "@/core/map-generator";
import { createCamera, clampCamera, screenToWorld } from "@/engine/camera";
import { renderMap } from "./renderer";
import type { GameMap } from "@/core/types";
import type { Camera } from "@/engine/camera";
import classes from "./GameWorld.module.css";

const GameWorld = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<GameMap | null>(null);
  const cameraRef = useRef<Camera>(createCamera());
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Generate map
    mapRef.current = generateMap();

    // Resize handler
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Render loop
    const render = () => {
      if (mapRef.current) {
        renderMap(ctx, mapRef.current, cameraRef.current, canvas.width, canvas.height);
      }
      rafRef.current = requestAnimationFrame(render);
    };
    rafRef.current = requestAnimationFrame(render);

    // Pan: mouse down
    const onMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
    };

    // Pan: mouse move
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - lastMouseRef.current.x;
      const dy = e.clientY - lastMouseRef.current.y;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };

      const cam = cameraRef.current;
      cameraRef.current = clampCamera({
        ...cam,
        x: cam.x + dx,
        y: cam.y + dy,
      });
    };

    // Pan: mouse up
    const onMouseUp = () => {
      isDraggingRef.current = false;
    };

    // Zoom: wheel
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = cameraRef.current;
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = cam.zoom * zoomFactor;

      // Zoom toward cursor position
      const { wx, wy } = screenToWorld(e.clientX, e.clientY, cam);
      const zoomed = clampCamera({ x: cam.x, y: cam.y, zoom: newZoom });

      cameraRef.current = clampCamera({
        x: e.clientX - wx * zoomed.zoom,
        y: e.clientY - wy * zoomed.zoom,
        zoom: zoomed.zoom,
      });
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  return <canvas ref={canvasRef} className={classes.canvas} />;
};

export { GameWorld };
