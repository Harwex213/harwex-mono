import {
  IDLE,
  transition,
  type InteractionCommand,
  type InteractionEvent,
  type InteractionState,
} from "./interaction-machine";
import type { Point } from "../../domain/index";
import {
  mapPixelAt,
  provinceAt,
  type TStore,
} from "../../store/index";
import type { TMapCanvasServiceRegistry } from "./map-canvas-registry";

// Bridge from DOM events to `interaction-machine.ts`.
// The machine decides. This file only fills events and runs commands through the registry.

// A control inside the host must carry `data-hud-control`.
// Without the mark the host captures the pointer, and capture retargets the
// control's `click` to the host. The click then selects on the map instead.
function isHudControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-hud-control]") !== null;
}

// A keydown in a text field is text, not a map shortcut.
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

// Returns the function that removes the listeners.
function bindInput(
  host: HTMLElement,
  store: TStore,
  registry: TMapCanvasServiceRegistry,
): () => void {
  let state: InteractionState = IDLE;

  function pixelAtClient(clientX: number, clientY: number): Point | null {
    const rect = host.getBoundingClientRect();
    return mapPixelAt(store, clientX - rect.left, clientY - rect.top);
  }

  // `null` for both sea and bare canvas, so a click there clears the selection.
  function provinceAtClient(clientX: number, clientY: number): number | null {
    const pixel = pixelAtClient(clientX, clientY);
    return pixel ? provinceAt(store, pixel.x, pixel.y) : null;
  }

  function run(command: InteractionCommand, domEvent: Event | null): void {
    switch (command.type) {
      case "preventDefault": {
        if (domEvent) {
          domEvent.preventDefault();
        }
        return;
      }
      case "capturePointer": {
        host.setPointerCapture(command.pointerId);
        return;
      }
      case "releasePointer": {
        if (host.hasPointerCapture(command.pointerId)) {
          host.releasePointerCapture(command.pointerId);
        }
        return;
      }
      case "hover": {
        registry.setCursor(command.pixel);
        registry.setHoveredProvince(
          command.pixel ? provinceAt(store, command.pixel.x, command.pixel.y) : null,
        );
        return;
      }
      case "setPanning": {
        registry.setPanning(command.on);
        return;
      }
      case "panTo": {
        registry.panTo(command.x, command.y);
        return;
      }
      case "selectProvinceAt": {
        registry.selectProvince(provinceAtClient(command.clientX, command.clientY));
        return;
      }
      case "selectCountryAt": {
        registry.selectCountryOfProvince(provinceAtClient(command.clientX, command.clientY));
        return;
      }
      case "zoomAt": {
        const rect = host.getBoundingClientRect();
        registry.zoomAtPoint(command.clientX - rect.left, command.clientY - rect.top, command.factor);
        return;
      }
      case "toggleLabels": {
        registry.toggleLabels();
        return;
      }
      case "resetView": {
        registry.resetView();
        return;
      }
    }
  }

  // The state is stored before the commands run.
  function dispatch(event: InteractionEvent, domEvent: Event | null): void {
    const next = transition(state, event);
    state = next.state;
    for (const command of next.commands) {
      run(command, domEvent);
    }
  }

  const onPointerDown = (event: PointerEvent): void => {
    const current = store.view.view.peek();
    dispatch(
      {
        type: "pointerDown",
        pointerId: event.pointerId,
        button: event.button,
        ctrlKey: event.ctrlKey,
        clientX: event.clientX,
        clientY: event.clientY,
        onHudControl: isHudControl(event.target),
        view: current ? { x: current.x, y: current.y } : null,
      },
      event,
    );
  };

  const onPointerMove = (event: PointerEvent): void => {
    dispatch(
      {
        type: "pointerMove",
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        pixel: pixelAtClient(event.clientX, event.clientY),
      },
      event,
    );
  };

  const onPointerUp = (event: PointerEvent): void => {
    dispatch(
      {
        type: "pointerUp",
        pointerId: event.pointerId,
        button: event.button,
        ctrlKey: event.ctrlKey,
        clientX: event.clientX,
        clientY: event.clientY,
        onHudControl: isHudControl(event.target),
      },
      event,
    );
  };

  const onPointerCancel = (event: PointerEvent): void => {
    dispatch({ type: "pointerCancel", pointerId: event.pointerId }, event);
  };

  const onPointerLeave = (event: PointerEvent): void => {
    dispatch({ type: "pointerLeave", pointerId: event.pointerId }, event);
  };

  const onLostPointerCapture = (event: PointerEvent): void => {
    dispatch({ type: "lostPointerCapture" }, event);
  };

  const onContextMenu = (event: MouseEvent): void => {
    dispatch(
      {
        type: "contextMenu",
        clientX: event.clientX,
        clientY: event.clientY,
        onHudControl: isHudControl(event.target),
      },
      event,
    );
  };

  const onDoubleClick = (event: MouseEvent): void => {
    dispatch(
      {
        type: "doubleClick",
        clientX: event.clientX,
        clientY: event.clientY,
        onHudControl: isHudControl(event.target),
      },
      event,
    );
  };

  const onAuxClick = (event: MouseEvent): void => {
    dispatch({ type: "auxClick" }, event);
  };

  const onWheel = (event: WheelEvent): void => {
    dispatch(
      {
        type: "wheel",
        clientX: event.clientX,
        clientY: event.clientY,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
      },
      event,
    );
  };

  // The single window keydown listener for map keys.
  const onKeyDown = (event: KeyboardEvent): void => {
    dispatch(
      {
        type: "keyDown",
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        typing: isTypingTarget(event.target),
      },
      event,
    );
  };

  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointercancel", onPointerCancel);
  host.addEventListener("pointerleave", onPointerLeave);
  host.addEventListener("lostpointercapture", onLostPointerCapture);
  host.addEventListener("contextmenu", onContextMenu);
  host.addEventListener("dblclick", onDoubleClick);
  host.addEventListener("auxclick", onAuxClick);
  // A native listener with `passive: false`, because a passive one ignores
  // `preventDefault` and the page scrolls behind the zoom. React wheel handlers are passive.
  host.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);

  return () => {
    host.removeEventListener("pointerdown", onPointerDown);
    host.removeEventListener("pointermove", onPointerMove);
    host.removeEventListener("pointerup", onPointerUp);
    host.removeEventListener("pointercancel", onPointerCancel);
    host.removeEventListener("pointerleave", onPointerLeave);
    host.removeEventListener("lostpointercapture", onLostPointerCapture);
    host.removeEventListener("contextmenu", onContextMenu);
    host.removeEventListener("dblclick", onDoubleClick);
    host.removeEventListener("auxclick", onAuxClick);
    host.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKeyDown);
  };
}

export { bindInput };
