import type { Signal } from "@preact/signals-react";
import {
  classifyPress,
  screenToMap,
} from "../../domain/index";
import type { TStore } from "../../store/index";
import type { TMapCanvasServiceRegistry } from "./map-canvas-registry";

// Turns the pointer and wheel events of the map host into registry calls. What
// a press means is `classifyPress` in the domain; this file keeps the gesture
// that a press starts until the pointer is released.

type Gesture =
  | { kind: "idle" }
  | { kind: "pan"; pointerId: number; startX: number; startY: number; originX: number; originY: number }
  | { kind: "paint"; pointerId: number; erasing: boolean; last: { x: number; y: number } }
  | { kind: "country"; pointerId: number; last: { x: number; y: number } };

const WHEEL_STEP = 1.0015;

// Wheel deltas come in three units depending on the browser and the device, and
// treating a 3-line notch as 3 pixels makes Firefox zoom in imperceptible steps.
const DELTA_TO_PIXELS = [1, 16, 100];

class InputHandler {
  private gesture: Gesture = { kind: "idle" };

  constructor(
    private readonly host: HTMLElement,
    private readonly store: TStore,
    private readonly registry: TMapCanvasServiceRegistry,
    private readonly spaceHeld: Signal<boolean>,
  ) {}

  private toPixel(event: PointerEvent): { x: number; y: number } {
    const rect = this.host.getBoundingClientRect();
    const point = screenToMap(this.store.view.view.peek(), event.clientX - rect.left, event.clientY - rect.top);

    return { x: Math.floor(point.x), y: Math.floor(point.y) };
  }

  onPointerDown = (event: PointerEvent): void => {
    if (!this.store.map.layer.peek()) {
      return;
    }

    this.host.setPointerCapture(event.pointerId);

    const press = classifyPress({
      spaceHeld: this.spaceHeld.peek(),
      button: event.button,
      altKey: event.altKey,
      mode: this.store.tools.mode.peek(),
      tool: this.store.tools.tool.peek(),
    });

    if (press.kind === "pan") {
      const view = this.store.view.view.peek();

      this.gesture = {
        kind: "pan",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: view.x,
        originY: view.y,
      };

      return;
    }

    if (press.kind === "ignore") {
      return;
    }

    const pixel = this.toPixel(event);

    if (press.kind === "pick") {
      this.registry.pickAt(pixel.x, pixel.y);

      return;
    }

    if (press.kind === "fill") {
      this.registry.fillAt(pixel.x, pixel.y, press.erasing);

      return;
    }

    if (press.kind === "countryStroke") {
      if (this.registry.beginCountryStroke(pixel.x, pixel.y, press.erasing)) {
        this.gesture = { kind: "country", pointerId: event.pointerId, last: pixel };
      }

      return;
    }

    if (this.registry.beginStroke(pixel.x, pixel.y, press.erasing)) {
      this.gesture = { kind: "paint", pointerId: event.pointerId, erasing: press.erasing, last: pixel };
    }
  };

  onPointerMove = (event: PointerEvent): void => {
    if (!this.store.map.layer.peek()) {
      return;
    }

    const gesture = this.gesture;

    if (gesture.kind === "pan") {
      if (gesture.pointerId === event.pointerId) {
        this.registry.panTo(
          gesture.originX + (event.clientX - gesture.startX),
          gesture.originY + (event.clientY - gesture.startY),
        );
      }

      return;
    }

    const pixel = this.toPixel(event);

    this.registry.setHover(pixel);

    if (gesture.kind === "idle" || gesture.pointerId !== event.pointerId) {
      return;
    }

    if (gesture.kind === "country") {
      this.registry.extendCountryStroke(gesture.last, pixel);
    } else {
      this.registry.extendStroke(gesture.last, pixel, gesture.erasing);
    }

    gesture.last = pixel;
  };

  onPointerEnd = (event: PointerEvent): void => {
    const gesture = this.gesture;

    if (gesture.kind === "idle" || gesture.pointerId !== event.pointerId) {
      return;
    }

    if (gesture.kind === "paint") {
      this.registry.endStroke();
    }

    if (gesture.kind === "country") {
      this.registry.endCountryStroke();
    }

    this.gesture = { kind: "idle" };
  };

  onPointerLeave = (): void => {
    this.registry.setHover(null);
  };

  onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  // A native listener, not React's: React registers `wheel` as passive, so
  // `preventDefault` there is ignored and the page scrolls while zooming.
  onWheel = (event: WheelEvent): void => {
    event.preventDefault();

    const rect = this.host.getBoundingClientRect();
    const delta = event.deltaY * (DELTA_TO_PIXELS[event.deltaMode] ?? 1);

    this.registry.zoomAtPoint(event.clientX - rect.left, event.clientY - rect.top, WHEEL_STEP ** -delta);
  };
}

export { InputHandler };
