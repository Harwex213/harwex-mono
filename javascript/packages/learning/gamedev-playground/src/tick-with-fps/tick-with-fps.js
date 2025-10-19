import { div, p } from "@hw/html-lib";
import { batch, signal } from "@hw/signals";
import { clsx } from "@hw/utils";
import classes from "./tick-with-fps.module.css";

const logger = (...data) => {
  // console.log(...data);
};

const loopOnRFA = (fps, tps, velocity) => {
  const x = signal(0);
  const renderedX = signal(0);

  const actualTPS = signal(0);
  const actualFPS = signal(1);

  let tempTick = 0;
  let tempFps = 0;
  let sinceLastSecond = 0;
  let sinceLastTick = 0;
  let sinceLastFrame = 0;
  let lastCall = performance.now();
  let callNumber = 0;

  // а что если js движок не будет успевать ранать 60 тиков в сек?...
  const msBetweenTicks = 1000 / tps;
  const msBetweenFrames = 1000 / fps;
  const velocityPerTick = (velocity / 1000) * tps;

  const frame = (timestamp) => {
    batch(() => {
      callNumber++;

      const elapsed = timestamp - lastCall;
      lastCall = timestamp;

      sinceLastSecond += elapsed;
      sinceLastTick += elapsed;
      sinceLastFrame += elapsed;

      logger("tick!", callNumber++, sinceLastTick, msBetweenTicks);

      if (sinceLastTick >= msBetweenTicks) {
        // Do tick...
        // logger("tick!", sinceLastTick, msBetweenTicks);

        x.value += velocityPerTick;

        tempTick++;
        sinceLastTick = 0;
      }

      if (sinceLastFrame >= msBetweenFrames) {
        // Do frame...
        // logger("frame!", sinceLastFrame, msBetweenFrames);

        const animationModifier = sinceLastFrame / msBetweenFrames;
        renderedX.value += (velocityPerTick * animationModifier);

        tempFps++;
        sinceLastFrame = 0;
      }

      if (sinceLastSecond >= 1000) {
        // Do stat...
        // logger("second!", sinceLastSecond);

        actualTPS.value = tempTick;
        actualFPS.value = tempFps;

        tempFps = 0;
        tempTick = 0;
        sinceLastSecond = 0;
      }

      requestAnimationFrame(frame);
    })
  };

  requestAnimationFrame(frame);

  return { x, renderedX, actualTPS, actualFPS };
}

const loopOnIntervalAndRFA = (fps, tps, velocity) => {
  const x = signal(0);
  const renderedX = signal(0);

  const actualTPS = signal(0);
  const actualFPS = signal(1);

  let tempTick = 0;
  let sinceLastSecondTick = 0;
  let lastTickCall = performance.now();

  // а что если js движок не будет успевать ранать 60 тиков в сек?...
  const msBetweenTicks = 1000 / tps;
  const velocityMs = velocity / 1000;

  const intervalId = setInterval(() => {
    batch(() => {
      const now = performance.now();

      const elapsed = now - lastTickCall;
      sinceLastSecondTick += elapsed;
      lastTickCall = now;

      x.value += velocityMs * elapsed;
      tempTick++;

      if (sinceLastSecondTick >= 1000) {
        actualTPS.value = tempTick;

        tempTick = 0;
        sinceLastSecondTick = 0;
      }
    })
  }, msBetweenTicks);

  let tempFps = 0;
  let lastRenderedFrame = 0;
  let lastFrameCall = performance.now();
  let sinceLastFrame = 0;
  let sinceLastSecondFrame = 0;
  const msBetweenFrames = 1000 / fps;

  let stop = false;

  const frame = (timestamp) => {
    batch(() => {
      const elapsed = timestamp - lastFrameCall;
      sinceLastSecondFrame += elapsed;
      sinceLastFrame += elapsed;
      lastFrameCall = timestamp;

      const fpsModifier = elapsed / msBetweenFrames;
      tempFps = tempFps + (fpsModifier > 1 ? 1 : fpsModifier);
      if (tempFps - lastRenderedFrame >= 1) {
        const deltaTime = sinceLastFrame / 1000;
        renderedX.value += (velocity * deltaTime);

        lastRenderedFrame = tempFps;
        sinceLastFrame = 0;
      }

      if (sinceLastSecondFrame >= 1000) {
        actualFPS.value = tempFps.toFixed(2);

        tempFps = 0;
        lastRenderedFrame = 0;
        sinceLastSecondFrame = 0;
      }

      if (!stop) {
        requestAnimationFrame(frame);
      }
    })
  };

  requestAnimationFrame(frame);

  const finalizer = () => {
    stop = true;
    clearInterval(intervalId);
  }

  return { finalizer, x, renderedX, actualTPS, actualFPS };
}

const scope = (fps, tps, velocity) => {
  const container = div({ className: classes.scope });

  const definedStats = p({ key: "stats", className: classes.scopeTitle })
    .content(`DEFINED. ${fps} FPS, ${tps} TPS, ${velocity}px per sec`);

  const actualStats = p({ key: "actualStats", className: classes.scopeTitle });

  const { finalizer, x, renderedX, actualTPS, actualFPS } = loopOnIntervalAndRFA(fps, tps, velocity);

  actualStats.assocEffect(() => {
    actualStats.content(`ACTUAL.  ${actualFPS.value} FPS, ${actualTPS.value} TPS`);
  });

  const baloon = div({ key: "baloon", className: classes.baloon });

  baloon.assocEffect(() => {
    baloon.content(`${x.value.toFixed(2)} ${renderedX.value.toFixed(2)}`);
    baloon.props({ style: { left: `${renderedX.value.toFixed(2)}px` } });
  })

  const intervalId = setInterval(() => {
    console.log(`${fps} FPS, ${tps} TPS, ${velocity}px per sec`, x.peek(), renderedX.peek());
  }, 1000);
  container.addFinalizer(() => clearInterval(intervalId));

  container.children([
    definedStats,
    actualStats,
    baloon,
  ]);

  return container;
};

const TPS = 60;
const VELOCITY = 200;

const tickWithFps = () => {
  return div({ className: clsx(classes.container, classes.variables) }).children([
    scope(15, TPS, VELOCITY),
    scope(60, TPS, VELOCITY),
    scope(120, TPS, VELOCITY),
    scope(240, TPS, VELOCITY),
  ]);
};

export { tickWithFps };