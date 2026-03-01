interface GameLoopCallbacks {
  update: (dt: number) => void;
  render: () => void;
}

function createGameLoop(callbacks: GameLoopCallbacks): {
  start: () => void;
  stop: () => void;
  togglePause: () => boolean;
  isPaused: () => boolean;
} {
  let rafId = 0;
  let lastTime = 0;
  let running = false;
  let paused = false;

  const loop = (now: number) => {
    if (!running) return;

    if (lastTime === 0) {
      lastTime = now;
    }

    let dt = (now - lastTime) / 1000;
    lastTime = now;

    // Cap delta time to prevent spiral of death on tab switch
    if (dt > 0.1) dt = 0.1;

    if (!paused) {
      callbacks.update(dt);
    }
    callbacks.render();

    rafId = requestAnimationFrame(loop);
  };

  return {
    start() {
      if (running) return;
      running = true;
      lastTime = 0;
      rafId = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
    },
    togglePause() {
      paused = !paused;
      if (!paused) lastTime = 0;
      return paused;
    },
    isPaused() {
      return paused;
    },
  };
}

export type { GameLoopCallbacks };
export { createGameLoop };
