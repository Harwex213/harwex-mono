import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import { easeInOutCubic, quadPoint } from "./bezier";
import { FLIGHT_MS, RESOURCE_GLYPHS } from "../../store/anim-state";
import { PALETTE } from "../palette";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TFlight } from "../../store/anim-state";
import type { TTickTaxAction } from "../../domain/registry";

/**
 * The glyphs of the tax phase, drawn on one fixed full-viewport canvas over the
 * island page (plan §4.5). The layer owns no state: it reads `store.anim` and
 * hands every frame to `tickTax`, which is what actually lands the payouts.
 *
 * The RAF loop runs only while the stage is `flying` or `pause`, and the
 * cleanup cancels it — a forgotten handle would leave a second loop running.
 */

type TTaxFlightLayerRegistrySlice = {
  tickTax: TTickTaxAction;
};

type TTaxFlightLayerProps = {
  registry: TTaxFlightLayerRegistrySlice;
};

const GLYPH_PX = 22;
const DEFAULT_DPR = 1;
const MIN_CANVAS_PX = 1;

/** Three dots trail the glyph, one every `TRAIL_STEP` of the flight. */
const TRAIL_DOT_COUNT = 3;
const TRAIL_STEP = 0.06;
const TRAIL_DOT_RADIUS_PX = 4;
const TRAIL_BASE_ALPHA = 0.34;
const TRAIL_ALPHA_FALLOFF = 0.09;

const GLYPH_SHADOW_BLUR_PX = 12;

const CANVAS_LABEL_RU = "Полёт ресурсов";

const clamp01 = (value: number): number => {
  return Math.min(1, Math.max(0, value));
};

/** Toxicity trails green, everything else gold, as in the HUD. */
const trailColour = (flight: TFlight): string => {
  if (flight.resource === "toxicity") {
    return PALETTE.toxic;
  }

  if (flight.resource === "insane") {
    return PALETTE.insane;
  }

  return PALETTE.gold;
};

const drawFlight = (ctx: CanvasRenderingContext2D, flight: TFlight, nowMs: number): void => {
  const progress = clamp01((nowMs - flight.startMs) / FLIGHT_MS);
  const colour = trailColour(flight);

  ctx.fillStyle = colour;
  for (let dot = TRAIL_DOT_COUNT; dot >= 1; dot -= 1) {
    const trailProgress = progress - dot * TRAIL_STEP;
    if (trailProgress <= 0) {
      continue;
    }

    const point = quadPoint(flight.from, flight.control, flight.to, easeInOutCubic(trailProgress));
    ctx.globalAlpha = Math.max(0, TRAIL_BASE_ALPHA - dot * TRAIL_ALPHA_FALLOFF);
    ctx.beginPath();
    ctx.arc(point.x, point.y, TRAIL_DOT_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
  }

  const head = quadPoint(flight.from, flight.control, flight.to, easeInOutCubic(progress));
  ctx.globalAlpha = 1;
  ctx.shadowColor = colour;
  ctx.shadowBlur = GLYPH_SHADOW_BLUR_PX;
  ctx.font = `${GLYPH_PX}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(RESOURCE_GLYPHS[flight.resource], head.x, head.y);
  ctx.shadowBlur = 0;
};

const TaxFlightLayer: FC<TTaxFlightLayerProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stage = store.anim.taxStage.value;

  useEffect(() => {
    if (stage !== "flying" && stage !== "pause") {
      return;
    }

    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    let frame = 0;

    const paint = (): void => {
      const nowMs = performance.now();

      // The loop is the clock of the whole phase, not only of the drawing.
      registry.tickTax(nowMs);

      const dpr = window.devicePixelRatio || DEFAULT_DPR;
      const width = Math.max(MIN_CANVAS_PX, Math.round(window.innerWidth * dpr));
      const height = Math.max(MIN_CANVAS_PX, Math.round(window.innerHeight * dpr));
      if (canvas.width !== width) {
        canvas.width = width;
      }
      if (canvas.height !== height) {
        canvas.height = height;
      }

      const ctx = canvas.getContext("2d");
      if (ctx === null) {
        return;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      for (const flight of store.anim.flights.peek()) {
        if (flight.landed === true) {
          continue;
        }
        if (nowMs < flight.startMs) {
          continue;
        }

        drawFlight(ctx, flight, nowMs);
      }

      frame = requestAnimationFrame(paint);
    };

    frame = requestAnimationFrame(paint);

    return () => {
      cancelAnimationFrame(frame);
      const ctx = canvas.getContext("2d");
      if (ctx === null) {
        return;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [registry, stage, store]);

  return (
    <canvas
      ref={canvasRef}
      className="tax-flight-layer"
      aria-label={CANVAS_LABEL_RU}
      aria-hidden={stage === "flying" || stage === "pause" ? undefined : true}
    />
  );
};

export type { TTaxFlightLayerRegistrySlice };
export { TaxFlightLayer };
