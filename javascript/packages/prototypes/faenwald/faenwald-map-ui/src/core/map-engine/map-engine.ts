import type { TMapAssets, TMapState, TProvince } from "./map.ts";
import { getPixelHex, loadImage, loadProvinces } from "./utils.ts";
import { detectBorders } from "./detect-borders";
import { buildHighlight } from "./map-engine-core";

const ZOOM_FACTOR = 1.1;

const NO_PROVINCE_ID = "#ffffff";

type TMapEngineState = {
  rafId: number;
  isDragging: boolean;
  hasDragged: boolean;
  lastX: number;
  lastY: number;
  selectedProvince: TProvince | null;
  hoveredProvince: TProvince | null;
  hoverClientX: number;
  hoverClientY: number;
  isLoading: boolean;
};

enum EMapEngineEvent {
  ASSETS_LOADED = "ASSETS_LOADED",
  PROVINCE_SELECTED = "PROVINCE_SELECTED",
  PROVINCE_HOVERED = "PROVINCE_HOVERED",
}

type TMapEngineEventSubscriber = (event: EMapEngineEvent) => void;

class MapEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly mapState: TMapState = {
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  };
  private readonly state: TMapEngineState = {
    rafId: 0,
    isDragging: false,
    hasDragged: false,
    lastX: 0,
    lastY: 0,
    selectedProvince: null,
    hoveredProvince: null,
    hoverClientX: 0,
    hoverClientY: 0,
    isLoading: false,
  };
  private assets: TMapAssets | null = null;
  private readonly subscribers: TMapEngineEventSubscriber[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.resizeObserver = new ResizeObserver(() => {
      this.syncCanvasSize();
      const assets = this.assets;
      if (assets) {
        this.initScale(assets.baseImg.naturalWidth, assets.baseImg.naturalHeight);
      }
    });
    this.resizeObserver.observe(canvas);

    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.stopDrag);
    canvas.addEventListener("mouseleave", this.onMouseLeave);
    canvas.addEventListener("click", this.onClick);

    this.state.rafId = requestAnimationFrame(this.renderFrame);

    // TODO: change to URL instances
    Promise.all([
      loadImage("/assets/map_base.jpg"),
      loadImage("/assets/map_provinces.png"),
      loadProvinces(),
    ]).then(([baseImg, provincesImg, provincesMap]) => {
      const offscreen = new OffscreenCanvas(provincesImg.naturalWidth, provincesImg.naturalHeight);
      const offCtx = offscreen.getContext("2d")!;
      offCtx.drawImage(provincesImg, 0, 0);
      const provincesImageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);

      const { canvas: borderCanvas, dilatedMask } = detectBorders(provincesImageData, provincesMap);

      // findUniqueColors(provincesImageData);

      // const duplicateProvincesCanvas = findDuplicateAresAndHighlightThem(provincesImageData);

      this.assets = {
        baseImg,
        provincesImageData,
        provincesMap,
        borderCanvas,
        dilatedMask,
        duplicateProvincesCanvas: null,
        highlightCanvas: null,
        selectedColor: null,
      };

      this.initScale(baseImg.naturalWidth, baseImg.naturalHeight);
      this.state.isLoading = false;

      this.dispatchEvent(EMapEngineEvent.ASSETS_LOADED);
    })
  }

  public get selectedProvice() {
    return this.state.selectedProvince;
  }

  public get hoveredProvince() {
    return this.state.hoveredProvince;
  }

  public get hoverPosition() {
    return { x: this.state.hoverClientX, y: this.state.hoverClientY };
  }

  public get provincesCopy() {
    if (!this.assets) {
      throw new Error("Assets not loaded yet");
    }

    return Object.values(this.assets.provincesMap);
  }

  public destroy() {
    cancelAnimationFrame(this.state.rafId);
    this.resizeObserver.disconnect();

    const canvas = this.canvas;

    canvas.removeEventListener("wheel", this.onWheel);
    canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.stopDrag);
    canvas.removeEventListener("mouseleave", this.onMouseLeave);
    canvas.removeEventListener("click", this.onClick);

    this.subscribers.splice(0, this.subscribers.length);
  }

  public subscribeOnEvents(subscriber: (event: EMapEngineEvent) => void) {
    this.subscribers.push(subscriber);
  }

  private syncCanvasSize = () => {
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;
  }

  private initScale = (imgWidth: number, imgHeight: number) => {
    const canvas = this.canvas;
    const mapState = this.mapState;

    const scaleX = this.canvas.width / imgWidth;
    const scaleY = this.canvas.height / imgHeight;

    const scale = Math.min(scaleX, scaleY);

    mapState.scale = scale;
    mapState.offsetX = (canvas.width - imgWidth * scale) / 2;
    mapState.offsetY = (canvas.height - imgHeight * scale) / 2;
  }

  private getCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = this.canvas;

    // TODO: review, maybe should be refactored due to layout shift
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  private renderFrame = () => {
    const canvas = this.canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx || !this.assets) {
      this.state.rafId = requestAnimationFrame(this.renderFrame);
      return;
    }

    const { baseImg, borderCanvas, highlightCanvas, duplicateProvincesCanvas } = this.assets;
    const { offsetX, offsetY, scale } = this.mapState;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.drawImage(baseImg, 0, 0);
    ctx.drawImage(borderCanvas, 0, 0);
    if (duplicateProvincesCanvas) {
      ctx.drawImage(duplicateProvincesCanvas, 0, 0);
    }
    if (highlightCanvas) {
      ctx.drawImage(highlightCanvas, 0, 0);
    }
    ctx.restore();

    this.state.rafId = requestAnimationFrame(this.renderFrame);
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const assets = this.assets;
    if (!assets) {
      return;
    }

    const canvas = this.canvas;
    const mapState = this.mapState;

    const { x, y } = this.getCanvasCoords(e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;

    const minScale = Math.min(
      canvas.width / assets.baseImg.naturalWidth,
      canvas.height / assets.baseImg.naturalHeight,
    ) * 0.5;

    const newScale = Math.min(8, Math.max(minScale, mapState.scale * factor));
    const worldX = (x - mapState.offsetX) / mapState.scale;
    const worldY = (y - mapState.offsetY) / mapState.scale;

    mapState.scale = newScale;
    mapState.offsetX = x - worldX * newScale;
    mapState.offsetY = y - worldY * newScale;
  }

  private onMouseDown = (e: MouseEvent) => {
    // TODO: remove magic number
    if (e.button !== 0) {
      return;
    }

    const state = this.state;

    state.isDragging = true;
    state.hasDragged = false;
    state.lastX = e.clientX;
    state.lastY = e.clientY;

    this.canvas.style.cursor = "grabbing";
  }

  private onMouseMove = (e: MouseEvent) => {
    const state = this.state;

    if (state.isDragging) {
      const dx = e.clientX - state.lastX;
      const dy = e.clientY - state.lastY;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        state.hasDragged = true;
      }

      state.lastX = e.clientX;
      state.lastY = e.clientY;

      const mapState = this.mapState;

      mapState.offsetX += dx;
      mapState.offsetY += dy;

      if (state.hoveredProvince) {
        state.hoveredProvince = null;
        this.dispatchEvent(EMapEngineEvent.PROVINCE_HOVERED);
      }
      return;
    }

    this.updateHover(e.clientX, e.clientY);
  }

  private stopDrag = () => {
    this.state.isDragging = false;
    this.canvas.style.cursor = "grab";
  }

  private onMouseLeave = () => {
    this.stopDrag();
    if (this.state.hoveredProvince) {
      this.state.hoveredProvince = null;
      this.dispatchEvent(EMapEngineEvent.PROVINCE_HOVERED);
    }
  }

  private updateHover = (clientX: number, clientY: number) => {
    const state = this.state;
    const assets = this.assets;
    if (!assets) return;

    const { provincesImageData, provincesMap } = assets;
    const { x, y } = this.getCanvasCoords(clientX, clientY);
    const mapState = this.mapState;

    const imgX = Math.round((x - mapState.offsetX) / mapState.scale);
    const imgY = Math.round((y - mapState.offsetY) / mapState.scale);
    const { width, height } = provincesImageData;

    let province: TProvince | null = null;

    if (imgX >= 0 && imgY >= 0 && imgX < width && imgY < height) {
      const color = getPixelHex(provincesImageData.data, imgX, imgY, width);
      if (color !== NO_PROVINCE_ID) {
        province = provincesMap[color] ?? null;
      }
    }

    const prev = state.hoveredProvince;
    state.hoveredProvince = province;
    state.hoverClientX = clientX;
    state.hoverClientY = clientY;

    if (prev?.provinceId !== province?.provinceId) {
      this.dispatchEvent(EMapEngineEvent.PROVINCE_HOVERED);
    }
  }

  private onClick = (e: MouseEvent) => {
    const state = this.state;
    const assets = this.assets;
    if (state.hasDragged || !assets) {
      return;
    }

    const { provincesImageData, provincesMap } = assets;
    const { x, y } = this.getCanvasCoords(e.clientX, e.clientY);
    const mapState = this.mapState;

    const imgX = Math.round((x - mapState.offsetX) / mapState.scale);
    const imgY = Math.round((y - mapState.offsetY) / mapState.scale);

    const { width, height } = provincesImageData;

    if (imgX < 0 || imgY < 0 || imgX >= width || imgY >= height) {
      assets.highlightCanvas = null;
      assets.selectedColor = null;

      state.selectedProvince = null;
      this.dispatchEvent(EMapEngineEvent.PROVINCE_SELECTED);

      return;
    }

    const color = getPixelHex(provincesImageData.data, imgX, imgY, width);
    const province = provincesMap[color];

    if (!province || color === NO_PROVINCE_ID) {
      assets.highlightCanvas = null;
      assets.selectedColor = null;

      state.selectedProvince = null;
      this.dispatchEvent(EMapEngineEvent.PROVINCE_SELECTED);

      return;
    }

    if (assets.selectedColor !== color) {
      assets.highlightCanvas = buildHighlight(provincesImageData, color, assets.dilatedMask);
      assets.selectedColor = color;
    }

    state.selectedProvince = province;
    this.dispatchEvent(EMapEngineEvent.PROVINCE_SELECTED);
  }

  private dispatchEvent(event: EMapEngineEvent) {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }
}

export { MapEngine, EMapEngineEvent }
