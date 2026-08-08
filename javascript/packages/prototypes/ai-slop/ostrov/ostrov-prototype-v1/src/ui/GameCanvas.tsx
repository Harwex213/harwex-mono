import { useEffect, useRef } from "react";
import { BUILDING_BY_ID, CELL, SKILL_BY_ID } from "../game/config";
import * as hud from "../game/hud";
import { game } from "../game/instance";
import type { Camera } from "../game/render/camera";
import { clampCamera, createCamera, screenToWorld, zoomAt } from "../game/render/camera";
import type { Pointer } from "../game/render/renderer";
import { Renderer, sectorOf } from "../game/render/renderer";
import { placementError } from "../game/world";

function GameCanvas(): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) {
      return;
    }
    const renderer = new Renderer(canvas);
    const core = game.world.buildings.find((building) => building.defId === "core");
    const camera: Camera = createCamera(core?.x ?? 0, core?.y ?? 0);
    const pointer: Pointer = { worldX: 0, worldY: 0, cx: 0, cy: 0, over: false };

    let dragging = false;
    let pressed = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    let frame = 0;
    let previous = performance.now();

    const updatePointer = (event: MouseEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const point = screenToWorld(camera, rect.width, rect.height, event.clientX - rect.left, event.clientY - rect.top);
      pointer.worldX = point.x;
      pointer.worldY = point.y;
      const mode = hud.mapMode.value;
      const size = mode.kind === "build" ? BUILDING_BY_ID.get(mode.id)!.cells : 1;
      // Centre the footprint on the cursor for multi-cell buildings.
      pointer.cx = Math.floor(point.x / CELL - (size - 1) / 2);
      pointer.cy = Math.floor(point.y / CELL - (size - 1) / 2);
      pointer.over = true;
    };

    const onMove = (event: MouseEvent): void => {
      updatePointer(event);
      if (!pressed) {
        return;
      }
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 6) {
        dragging = true;
        camera.x -= dx / camera.zoom;
        camera.y -= dy / camera.zoom;
        clampCamera(camera);
      }
      lastX = event.clientX;
      lastY = event.clientY;
    };

    const onDown = (event: MouseEvent): void => {
      if (event.button !== 0) {
        return;
      }
      pressed = true;
      dragging = false;
      moved = 0;
      lastX = event.clientX;
      lastY = event.clientY;
    };

    const onUp = (event: MouseEvent): void => {
      if (event.button !== 0 || !pressed) {
        return;
      }
      pressed = false;
      if (dragging) {
        return;
      }
      updatePointer(event);
      handleClick(pointer);
    };

    const onContext = (event: MouseEvent): void => {
      event.preventDefault();
      updatePointer(event);
      if (hud.mapMode.value.kind !== "idle") {
        hud.mapMode.value = { kind: "idle" };
        return;
      }
      game.setRally(pointer.worldX, pointer.worldY);
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(
        camera,
        rect.width,
        rect.height,
        event.clientX - rect.left,
        event.clientY - rect.top,
        event.deltaY < 0 ? 1.12 : 1 / 1.12,
      );
    };

    const onLeave = (): void => {
      pointer.over = false;
      pressed = false;
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        hud.mapMode.value = { kind: "idle" };
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        game.setSpeed(hud.speed.value === 0 ? 1 : 0);
        return;
      }
      if (event.key === "1" || event.key === "2" || event.key === "3") {
        game.setSpeed(Number(event.key));
      }
    };

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("contextmenu", onContext);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mouseleave", onLeave);
    window.addEventListener("keydown", onKey);

    const loop = (now: number): void => {
      const dt = Math.min(0.1, (now - previous) / 1000);
      previous = now;
      game.advance(dt);
      const mode = hud.mapMode.value;
      let valid = false;
      if (mode.kind === "build") {
        const def = BUILDING_BY_ID.get(mode.id)!;
        valid = placementError(game.world, def, pointer.cx, pointer.cy) === null;
      }
      renderer.draw(game.world, camera, pointer, mode, valid, hud.selectedSector.value);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("contextmenu", onContext);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return <canvas ref={ref} className="canvas" />;
}

function handleClick(pointer: Pointer): void {
  const mode = hud.mapMode.value;
  if (mode.kind === "build") {
    game.build(mode.id, pointer.cx, pointer.cy);
    return;
  }
  if (mode.kind === "skill") {
    const def = SKILL_BY_ID.get(mode.id)!;
    if (def.targeted) {
      game.cast(mode.id, pointer.worldX, pointer.worldY);
    }
    hud.mapMode.value = { kind: "idle" };
    return;
  }
  if (mode.kind === "rally") {
    game.setRally(pointer.worldX, pointer.worldY);
    hud.mapMode.value = { kind: "idle" };
    return;
  }
  hud.selectedSector.value = sectorOf(pointer);
}

export { GameCanvas };
