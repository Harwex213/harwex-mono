/**
 * Fixed-timestep simulation inside a requestAnimationFrame render loop.
 * Deterministic ticks regardless of frame rate; accumulator clamped so a
 * backgrounded tab doesn't fast-forward a burst of catch-up ticks.
 */
function createLoop({ tickRate = 20, tick, render }) {
  const dt = 1 / tickRate;
  let acc = 0;
  let last = 0;
  let raf = 0;

  function frame(now) {
    acc += Math.min((now - last) / 1000, 0.25);
    last = now;
    while (acc >= dt) {
      tick(dt);
      acc -= dt;
    }
    render();
    raf = requestAnimationFrame(frame);
  }

  return {
    start() {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(raf);
    },
  };
}

export { createLoop };
