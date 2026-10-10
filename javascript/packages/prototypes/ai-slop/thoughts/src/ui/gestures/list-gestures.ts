import { effect } from "@preact/signals-react";
import { flushSync } from "react-dom";
import type { TAppRegistry } from "../../domain/registry";
import { isCategoryId } from "../../domain/thought";
import type { TStore } from "../../store/store";

const LONG_PRESS_MS = 320;
const SLOP = 8;
const RUBBER = 0.25;
const SNAP_MS = 280;
const SNAP_EASE = "cubic-bezier(0.2, 0.9, 0.3, 1)";
const AUTO_SCROLL_EDGE = 64;
const AUTO_SCROLL_SPEED = 14;
const DROP_MS = 180;
const LEAVE_MS = 240;

type TMode = "idle" | "pending" | "swipe" | "drag" | "native";

type TDown = {
  pointerId: number;
  pointerType: string;
  row: HTMLElement;
  surface: HTMLElement;
  x: number;
  y: number;
  baseOffset: number;
  // A tap that only closes another open row does nothing else.
  isClosing: boolean;
};

type TRowBox = {
  el: HTMLElement;
  top: number;
  height: number;
};

type TDrag = {
  row: HTMLElement;
  index: number;
  boxes: TRowBox[];
  step: number;
  startY: number;
  startScroll: number;
  pointerY: number;
  target: number;
  frameId: number | null;
};

const PLAINTEXT_ONLY = (() => {
  const probe = document.createElement("div");
  probe.contentEditable = "plaintext-only";

  return probe.contentEditable === "plaintext-only";
})();

const getRowId = (row: HTMLElement) => {
  return row.dataset.id ?? "";
};

const getSurface = (row: HTMLElement) => {
  return row.querySelector<HTMLElement>(".row-surface")!;
};

const getActionsWidth = (row: HTMLElement) => {
  return row.querySelector<HTMLElement>(".row-actions")?.offsetWidth ?? 0;
};

// The move buttons stay hidden while the row is closed: otherwise their color shows at the rounded corners.
const setOffset = (surface: HTMLElement, offset: number, isAnimated: boolean) => {
  const row = surface.parentElement!;
  surface.style.transition = isAnimated ? `transform ${SNAP_MS}ms ${SNAP_EASE}` : "none";
  surface.style.transform = offset === 0 ? "" : `translate3d(${offset}px, 0, 0)`;

  if (offset !== 0) {
    row.classList.add("is-swiped");
    return;
  }
  window.setTimeout(() => {
    if (surface.style.transform === "") {
      row.classList.remove("is-swiped");
    }
  }, isAnimated ? SNAP_MS : 0);
};

const vibrate = () => {
  navigator.vibrate?.(10);
};

// Handles every pointer gesture of the list through delegation:
// tap edits, a horizontal swipe opens the move buttons, a long press lifts the row for reordering.
class ListGestures {
  private mode: TMode = "idle";
  private down: TDown | null = null;
  private pressTimer: number | null = null;
  private openRow: HTMLElement | null = null;
  private drag: TDrag | null = null;
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly list: HTMLElement,
    private readonly store: TStore,
    private readonly registry: TAppRegistry,
  ) {
    this.listen(list, "pointerdown", this.onPointerDown);
    this.listen(list, "pointermove", this.onPointerMove);
    this.listen(list, "pointerup", this.onPointerUp);
    this.listen(list, "pointercancel", this.onPointerCancel);
    this.listen(list, "touchmove", this.onTouchMove, { passive: false });
    this.listen(list, "click", this.onClick);
    this.listen(list, "focusout", this.onFocusOut);
    this.listen(list, "keydown", this.onKeyDown);
    this.listen(list, "contextmenu", this.onContextMenu);

    let isFirstRun = true;
    this.disposers.push(effect(() => {
      this.store.activeCategory.value;
      if (isFirstRun) {
        isFirstRun = false;
        return;
      }
      this.closeOpenRow(false);
    }));
  }

  destroy() {
    this.clearPressTimer();
    for (const dispose of this.disposers) {
      dispose();
    }
  }

  private listen<E extends Event>(target: HTMLElement, type: string, handler: (event: E) => void, options?: AddEventListenerOptions) {
    target.addEventListener(type, handler as EventListener, options);
    this.disposers.push(() => {
      target.removeEventListener(type, handler as EventListener, options);
    });
  }

  // ---- pointer flow ----

  private readonly onPointerDown = (event: PointerEvent) => {
    if (this.mode !== "idle" || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.isContentEditable || target.closest(".row-actions")) {
      return;
    }

    if (this.openRow && !this.openRow.isConnected) {
      this.openRow = null;
    }

    const row = target.closest<HTMLElement>(".row");
    if (!row) {
      this.closeOpenRow(true);
      return;
    }

    // iOS does not blur a contenteditable after a tap on a plain div, so blur it here.
    const active = document.activeElement as HTMLElement | null;
    if (active?.isContentEditable && this.list.contains(active)) {
      active.blur();
    }

    const isClosing = this.openRow !== null && this.openRow !== row;
    if (isClosing) {
      this.closeOpenRow(true);
    }

    this.mode = "pending";
    this.down = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      row,
      surface: getSurface(row),
      x: event.clientX,
      y: event.clientY,
      baseOffset: row === this.openRow ? -getActionsWidth(row) : 0,
      isClosing,
    };

    if (!isClosing && row !== this.openRow) {
      this.pressTimer = window.setTimeout(this.startDrag, LONG_PRESS_MS);
    }
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    const down = this.down;
    if (!down || event.pointerId !== down.pointerId) {
      return;
    }

    const dx = event.clientX - down.x;
    const dy = event.clientY - down.y;

    if (this.mode === "pending") {
      if (Math.hypot(dx, dy) < SLOP) {
        return;
      }
      this.clearPressTimer();
      if (Math.abs(dx) > Math.abs(dy) && !down.isClosing) {
        this.mode = "swipe";
        down.row.setPointerCapture(event.pointerId);
      } else {
        // A vertical move belongs to the native scroll.
        this.mode = "native";
        return;
      }
    }

    if (this.mode === "swipe") {
      this.applySwipe(down, dx);
    } else if (this.mode === "drag" && this.drag) {
      this.drag.pointerY = event.clientY;
      this.updateDrag();
    }
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    const down = this.down;
    if (!down || event.pointerId !== down.pointerId) {
      return;
    }

    this.clearPressTimer();
    if (this.mode === "pending" && !down.isClosing) {
      this.handleTap(down.row);
    } else if (this.mode === "swipe") {
      this.finishSwipe(down, event.clientX - down.x);
    } else if (this.mode === "drag") {
      this.finishDrag();
    }
    this.reset();
  };

  private readonly onPointerCancel = (event: PointerEvent) => {
    const down = this.down;
    if (!down || event.pointerId !== down.pointerId) {
      return;
    }

    this.clearPressTimer();
    if (this.mode === "swipe") {
      setOffset(down.surface, down.baseOffset, true);
    } else if (this.mode === "drag") {
      this.finishDrag();
    }
    this.reset();
  };

  // While a row is dragged or swiped, the page must not scroll under the finger.
  private readonly onTouchMove = (event: TouchEvent) => {
    if (this.mode === "drag" || this.mode === "swipe") {
      event.preventDefault();
    }
  };

  private readonly onContextMenu = (event: Event) => {
    if (!(event.target as HTMLElement).isContentEditable) {
      event.preventDefault();
    }
  };

  private reset() {
    this.mode = "idle";
    this.down = null;
  }

  private clearPressTimer() {
    if (this.pressTimer !== null) {
      window.clearTimeout(this.pressTimer);
      this.pressTimer = null;
    }
  }

  // ---- tap → edit ----

  private handleTap(row: HTMLElement) {
    if (row === this.openRow) {
      this.closeOpenRow(true);
      return;
    }

    const text = row.querySelector<HTMLElement>(".row-text");
    if (!text) {
      return;
    }

    // focus() runs inside pointerup, so iOS opens the keyboard.
    text.contentEditable = PLAINTEXT_ONLY ? "plaintext-only" : "true";
    row.classList.add("is-editing");
    text.focus();

    const range = document.createRange();
    range.selectNodeContents(text);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  private readonly onFocusOut = (event: FocusEvent) => {
    const text = event.target as HTMLElement;
    if (!text.classList.contains("row-text") || !text.isContentEditable) {
      return;
    }

    const row = text.closest<HTMLElement>(".row");
    const value = text.innerText;
    text.contentEditable = "false";
    text.textContent = value.trim();
    row?.classList.remove("is-editing");
    window.getSelection()?.removeAllRanges();
    if (row) {
      this.registry.updateThoughtTextAction(getRowId(row), value);
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const text = event.target as HTMLElement;
    if (!text.isContentEditable || event.isComposing) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      text.blur();
    }
  };

  // ---- swipe → move buttons ----

  private applySwipe(down: TDown, dx: number) {
    const width = getActionsWidth(down.row);
    let offset = down.baseOffset + dx;
    if (offset > 0) {
      offset *= RUBBER;
    } else if (offset < -width) {
      offset = -width + (offset + width) * RUBBER;
    }
    setOffset(down.surface, offset, false);
  }

  private finishSwipe(down: TDown, dx: number) {
    const width = getActionsWidth(down.row);
    const offset = down.baseOffset + dx;
    // A short flick in either direction decides, not only the half-way point.
    const shouldOpen = down.baseOffset === 0 ? offset < -Math.min(width / 3, 60) : offset < -width + Math.min(width / 3, 60);

    if (shouldOpen) {
      setOffset(down.surface, -width, true);
      this.openRow = down.row;
    } else {
      setOffset(down.surface, 0, true);
      if (this.openRow === down.row) {
        this.openRow = null;
      }
    }
  }

  private closeOpenRow(isAnimated: boolean) {
    const row = this.openRow;
    this.openRow = null;
    if (row?.isConnected) {
      setOffset(getSurface(row), 0, isAnimated);
    }
  }

  private readonly onClick = (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-move]");
    const row = button?.closest<HTMLElement>(".row");
    const category = button?.dataset.move;
    if (!button || !row || !isCategoryId(category)) {
      return;
    }

    this.openRow = null;
    // The row folds first, then the thought leaves the category.
    row.style.height = `${row.offsetHeight}px`;
    void row.offsetHeight;
    row.classList.add("is-leaving");
    window.setTimeout(() => {
      this.registry.moveThoughtAction(getRowId(row), category);
    }, LEAVE_MS);
  };

  // ---- long press → reorder ----

  private readonly startDrag = () => {
    this.pressTimer = null;
    const down = this.down;
    if (!down || this.mode !== "pending") {
      return;
    }

    const rows = [...this.list.querySelectorAll<HTMLElement>(".row")];
    const index = rows.indexOf(down.row);
    if (index === -1) {
      return;
    }

    const boxes = rows.map((el) => ({ el, top: el.offsetTop, height: el.offsetHeight }));
    const gap = boxes.length > 1 ? boxes[1]!.top - boxes[0]!.top - boxes[0]!.height : 0;

    this.mode = "drag";
    this.drag = {
      row: down.row,
      index,
      boxes,
      step: boxes[index]!.height + gap,
      startY: down.y,
      startScroll: this.list.scrollTop,
      pointerY: down.y,
      target: index,
      frameId: null,
    };
    down.row.setPointerCapture(down.pointerId);
    down.row.classList.add("is-lifted");
    this.list.classList.add("is-sorting");
    vibrate();
    this.tickAutoScroll();
  };

  private readonly tickAutoScroll = () => {
    const drag = this.drag;
    if (!drag) {
      return;
    }

    const rect = this.list.getBoundingClientRect();
    let delta = 0;
    if (drag.pointerY < rect.top + AUTO_SCROLL_EDGE) {
      delta = -AUTO_SCROLL_SPEED * (1 - Math.max(0, drag.pointerY - rect.top) / AUTO_SCROLL_EDGE);
    } else if (drag.pointerY > rect.bottom - AUTO_SCROLL_EDGE) {
      delta = AUTO_SCROLL_SPEED * (1 - Math.max(0, rect.bottom - drag.pointerY) / AUTO_SCROLL_EDGE);
    }
    if (delta !== 0) {
      this.list.scrollTop += delta;
      this.updateDrag();
    }

    drag.frameId = requestAnimationFrame(this.tickAutoScroll);
  };

  private updateDrag() {
    const drag = this.drag;
    if (!drag) {
      return;
    }

    const dy = drag.pointerY - drag.startY + this.list.scrollTop - drag.startScroll;
    const own = drag.boxes[drag.index]!;
    const center = own.top + own.height / 2 + dy;
    let target = drag.index;

    drag.boxes.forEach((box, i) => {
      if (i === drag.index) {
        return;
      }
      const middle = box.top + box.height / 2;
      let shift = 0;
      if (i > drag.index && center > middle) {
        shift = -drag.step;
        target = Math.max(target, i);
      } else if (i < drag.index && center < middle) {
        shift = drag.step;
        target = Math.min(target, i);
      }
      box.el.style.transform = shift === 0 ? "" : `translate3d(0, ${shift}px, 0)`;
    });

    drag.target = target;
    drag.row.style.transform = `translate3d(0, ${dy}px, 0) scale(1.03)`;
  }

  private finishDrag() {
    const drag = this.drag;
    this.drag = null;
    if (!drag) {
      return;
    }

    if (drag.frameId !== null) {
      cancelAnimationFrame(drag.frameId);
    }

    // The lifted row glides into its slot, then the new order is committed.
    const { boxes, index, target } = drag;
    let slot = 0;
    if (target > index) {
      slot = boxes[target]!.top + boxes[target]!.height - (boxes[index]!.top + boxes[index]!.height);
    } else if (target < index) {
      slot = boxes[target]!.top - boxes[index]!.top;
    }
    drag.row.classList.add("is-dropping");
    drag.row.style.transform = `translate3d(0, ${slot}px, 0)`;

    window.setTimeout(() => {
      this.list.classList.remove("is-sorting");
      drag.row.classList.remove("is-lifted", "is-dropping");
      // flushSync renders the new order in the same frame as the cleared transforms, so nothing flickers.
      flushSync(() => {
        this.registry.reorderThoughtAction(getRowId(drag.row), target);
      });
      for (const box of boxes) {
        box.el.style.transform = "";
      }
    }, DROP_MS);
  }
}

export { ListGestures };
