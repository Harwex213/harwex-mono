import { useCallback, useEffect, useRef, useState } from "react";
import { MAP_CONFIG } from "@/config/map";
import { generateMap } from "@/core/map-generator";
import { spawnPawns } from "@/core/pawn-spawner";
import { updateMovement } from "@/core/systems/movement";
import { createCamera, clampCamera, screenToWorld } from "@/engine/camera";
import { createGameLoop } from "@/engine/game-loop";
import { renderMap, renderPawns } from "./renderer";
import { PawnInfoPanel } from "../panels/PawnInfoPanel";
import type { GameState, Pawn } from "@/core/types";
import type { Camera } from "@/engine/camera";
import classes from "./GameWorld.module.css";

const CLICK_THRESHOLD = 5;
const PAWN_HIT_RADIUS = 0.5;

const GameWorld = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const cameraRef = useRef<Camera>(createCamera());
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const mouseDownPosRef = useRef({ x: 0, y: 0 });
  const selectedPawnIdRef = useRef<number | null>(null);

  const [selectedPawnId, setSelectedPawnId] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);

  const getPawn = useCallback((id: number): Pawn | undefined => {
    return gameStateRef.current?.pawns.find((p) => p.id === id);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Generate map and spawn pawns
    const map = generateMap();
    const pawns = spawnPawns(map);
    gameStateRef.current = { map, pawns };

    // Resize handler
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Game loop
    const gameLoop = createGameLoop({
      update(dt) {
        const state = gameStateRef.current;
        if (!state) return;
        updateMovement(state.pawns, state.map, dt);
      },
      render() {
        const state = gameStateRef.current;
        if (!state) return;
        renderMap(ctx, state.map, cameraRef.current, canvas.width, canvas.height);
        renderPawns(ctx, state.pawns, cameraRef.current, selectedPawnIdRef.current);
      },
    });
    gameLoop.start();

    // Pan: mouse down
    const onMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
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

    // Pan: mouse up + click detection
    const onMouseUp = (e: MouseEvent) => {
      isDraggingRef.current = false;

      const dx = e.clientX - mouseDownPosRef.current.x;
      const dy = e.clientY - mouseDownPosRef.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < CLICK_THRESHOLD) {
        handleClick(e.clientX, e.clientY);
      }
    };

    const handleClick = (screenX: number, screenY: number) => {
      const state = gameStateRef.current;
      if (!state) return;

      const { tileSize } = MAP_CONFIG;
      const { wx, wy } = screenToWorld(screenX, screenY, cameraRef.current);
      const worldCol = wx / tileSize;
      const worldRow = wy / tileSize;

      // Find closest pawn within hit radius
      let closestPawn: Pawn | null = null;
      let closestDist = PAWN_HIT_RADIUS;

      for (const pawn of state.pawns) {
        const d = Math.sqrt(
          (pawn.x + 0.5 - worldCol) ** 2 + (pawn.y + 0.5 - worldRow) ** 2,
        );
        if (d < closestDist) {
          closestDist = d;
          closestPawn = pawn;
        }
      }

      const newId = closestPawn ? closestPawn.id : null;
      selectedPawnIdRef.current = newId;
      setSelectedPawnId(newId);
    };

    // Zoom: wheel
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = cameraRef.current;
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = cam.zoom * zoomFactor;

      const { wx, wy } = screenToWorld(e.clientX, e.clientY, cam);
      const zoomed = clampCamera({ x: cam.x, y: cam.y, zoom: newZoom });

      cameraRef.current = clampCamera({
        x: e.clientX - wx * zoomed.zoom,
        y: e.clientY - wy * zoomed.zoom,
        zoom: zoomed.zoom,
      });
    };

    // Pause: Space key
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        const nowPaused = gameLoop.togglePause();
        setPaused(nowPaused);
      }
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);

    return () => {
      gameLoop.stop();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div className={classes.container}>
      <canvas ref={canvasRef} className={classes.canvas} />
      {paused && <div className={classes.pauseOverlay}>Пауза</div>}
      <PawnInfoPanel pawnId={selectedPawnId} getPawn={getPawn} />
    </div>
  );
};

export { GameWorld };
