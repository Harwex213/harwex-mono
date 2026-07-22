/**
 * Domain-free pan & zoom canvas. Owns:
 * - the <canvas> element and dpr sizing,
 * - the camera {x, y, scale} (world → css px),
 * - fit-to-container on resize (until the first user pan/zoom),
 * - middle/right-drag pan, cursor-anchored wheel zoom,
 * - rAF-coalesced repaints and hover tracking.
 */

const DEFAULTS = {
  fitMargin: 24, // css px kept around the fitted world bounds
  zoomStep: 1.1, // per wheel tick, multiplicative
  zoomOutLimit: 0.5, // × fit scale
  zoomInLimit: 8, // × fit scale
};

const shallowEqualTargets = (a, b) => {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

/**
 * Everything domain-shaped comes in through `config`:
 * - `worldBounds` {minX, minY, maxX, maxY} — required; fit/center basis.
 * - `render(state)` — required; draws the scene. Called with {ctx, camera, hovered}
 *   after the module has cleared the canvas and baked dpr × camera into ctx, so it
 *   draws in pure world coordinates (divide stroke widths by camera. Scale to keep
 *   them screen-constant).
 * - `hitTest(worldX, worldY) → target | null` — optional; maps a world point to an
 *   opaque hover target. Omit it and `hovered` stays null.
 * - `isSameTarget(a, b)` — optional; hover change detection. Defaults to shallow
 *   key equality.
 * - `onActionStart` / `onActionMove` ({world, target, camera, requestRender}) and
 *   `onActionEnd` ({camera, requestRender}) — optional; left-button gesture hooks.
 *   They repaint explicitly via requestRender, never implicitly.
 * - `fitMargin`, `zoomStep`, `zoomOutLimit`, `zoomInLimit` — optional camera knobs.
 *
 * Returns {requestRender, destroy}:
 * - `requestRender` — repaints triggered outside canvas events (store changes,
 *   sidebar clicks).
 * - `destroy` — for the page's teardown.
 */
const initializeAbstractCanvas = (container, config) => {
  const {
    worldBounds,
    render,
    hitTest,
    isSameTarget = shallowEqualTargets,
    onActionStart,
    onActionMove,
    onActionEnd,
    fitMargin = DEFAULTS.fitMargin,
    zoomStep = DEFAULTS.zoomStep,
    zoomOutLimit = DEFAULTS.zoomOutLimit,
    zoomInLimit = DEFAULTS.zoomInLimit,
  } = config;

  const dpr = window.devicePixelRatio;

  const boundsWidth = worldBounds.maxX - worldBounds.minX;
  const boundsHeight = worldBounds.maxY - worldBounds.minY;

  const camera = { x: 0, y: 0, scale: 1 };
  let fitScale = 1; // basis for the zoom clamp; tracks panel size
  let userMoved = false; // resize refits the camera only until the first pan/zoom
  let hovered = null; // last hitTest result under the cursor
  let mode = null; // { type: "pan", lastX, lastY } | { type: "action" }

  let canvas;
  let ctx;
  let rafId = 0;

  const paint = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * camera.scale, 0, 0, dpr * camera.scale, dpr * camera.x, dpr * camera.y);
    render({ ctx, camera, hovered });
  };

  // coalesce event floods (pointermove, wheel) into one paint per frame
  const requestRender = () => {
    if (rafId) {
      return;
    }
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      paint();
    });
  };

  const toWorld = (event) => ({
    x: (event.offsetX - camera.x) / camera.scale,
    y: (event.offsetY - camera.y) / camera.scale,
  });

  const actionState = (event) => {
    const world = toWorld(event);
    return {
      world,
      target: hitTest ? hitTest(world.x, world.y) : null,
      camera,
      requestRender,
    };
  };

  const updateHover = (event) => {
    if (!hitTest) {
      return;
    }
    const world = toWorld(event);
    const target = hitTest(world.x, world.y);
    if (!isSameTarget(target, hovered)) {
      hovered = target;
      requestRender();
    }
  };

  const onPointerDown = (event) => {
    if (mode) {
      return;
    }
    if (event.button === 0) {
      mode = { type: "action" };
      onActionStart?.(actionState(event));
    } else if (event.button === 1 || event.button === 2) {
      event.preventDefault(); // middle button would start autoscroll
      mode = { type: "pan", lastX: event.clientX, lastY: event.clientY };
    } else {
      return;
    }
    // last: it throws on synthetic pointers (tests), and losing capture only
    // costs drag-past-the-edge tracking
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (mode?.type === "pan") {
      camera.x += event.clientX - mode.lastX;
      camera.y += event.clientY - mode.lastY;
      mode.lastX = event.clientX;
      mode.lastY = event.clientY;
      userMoved = true;
      requestRender();
      return;
    }
    if (mode?.type === "action") {
      onActionMove?.(actionState(event));
    }
    updateHover(event);
  };

  const onPointerUp = () => {
    if (mode?.type === "action") {
      onActionEnd?.({ camera, requestRender });
    }
    mode = null;
  };

  const onPointerLeave = () => {
    if (hovered) {
      hovered = null;
      requestRender();
    }
  };

  const onWheel = (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? zoomStep : 1 / zoomStep;
    const scale = Math.min(
      fitScale * zoomInLimit,
      Math.max(fitScale * zoomOutLimit, camera.scale * factor),
    );
    if (scale === camera.scale) {
      return;
    }
    // keep the world point under the cursor fixed across the scale change
    const screenX = event.offsetX;
    const screenY = event.offsetY;
    camera.x = screenX - ((screenX - camera.x) / camera.scale) * scale;
    camera.y = screenY - ((screenY - camera.y) / camera.scale) * scale;
    camera.scale = scale;
    userMoved = true;
    requestRender();
  };

  const resize = (width, height) => {
    if (!canvas) {
      canvas = document.createElement("canvas");
      container.appendChild(canvas);
      ctx = canvas.getContext("2d");

      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerUp);
      canvas.addEventListener("pointerleave", onPointerLeave);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    }

    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    fitScale = Math.max(
      0.01,
      Math.min((width - 2 * fitMargin) / boundsWidth, (height - 2 * fitMargin) / boundsHeight),
    );
    if (!userMoved) {
      camera.scale = fitScale;
      camera.x = (width - boundsWidth * fitScale) / 2 - worldBounds.minX * fitScale;
      camera.y = (height - boundsHeight * fitScale) / 2 - worldBounds.minY * fitScale;
    }

    paint();
  };

  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === container) {
        const size = entry.contentBoxSize[0];

        if (size) {
          resize(size.inlineSize, size.blockSize);
        }
      }
    }
  });
  resizeObserver.observe(container);

  const destroy = () => {
    resizeObserver.disconnect();
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
  };

  return { requestRender, destroy };
};

export { initializeAbstractCanvas };
