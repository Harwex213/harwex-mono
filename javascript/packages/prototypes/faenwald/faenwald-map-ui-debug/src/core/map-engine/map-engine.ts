import type { TProvince } from "@hw/faenwald-core";
import type { TGameContext, TMapAssets, TMapState } from "./map-types.js";
import { getPixelHex, loadImage } from "./utils.js";
import { detectBorders } from "./detect-borders";
import { buildAllHighlights, buildAllHoverBorders } from "./map-engine-core";
import { renderProvinceCenters } from "./map-engine-debug";
import { getLocalStorage, setLocalStorage } from "../../utils";
import { loadGameTurn, loadWarPhase } from "../../api/api";

const ZOOM_FACTOR = 1.1;

const ICON_SIZE = 44;
const ICON_SCALE = ICON_SIZE / 24; // SVG viewBox is 24x24

const SHIELD_PATH = new Path2D(
  "M12 22c-1.148 0-3.418-1.362-5.13-3.34C4.44 15.854 3 11.967 3 7a1 1 0 0 1 .629-.929c3.274-1.31 5.88-2.613 7.816-3.903a1 1 0 0 1 1.11 0c1.935 1.29 4.543 2.594 7.816 3.903A1 1 0 0 1 21 7c0 4.968-1.44 8.855-3.87 11.66C15.419 20.637 13.149 22 12 22z"
);

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
  isRenderingProvinceCenters: boolean;
  turn: string;
  phase: string;
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
    isRenderingProvinceCenters: getLocalStorage("isRenderingProvinceCenters") ?? false,
    turn: getLocalStorage("turn") ?? "4",
    phase: getLocalStorage("phase") ?? "2",
  };
  private assets: TMapAssets | null = null;
  private gameContext: TGameContext | null = null;
  private readonly subscribers: TMapEngineEventSubscriber[] = [];
  private provincesArray!: TProvince[];

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

    this.loadAssets();
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

  public get isRenderingProvinceCenters() {
    return this.state.isRenderingProvinceCenters;
  }

  public get provinces() {
    return this.provincesArray;
  }

  public set turn(value: string) {
    const parsed = Number.parseInt(value);
    if (!isNaN(parsed)) {
      this.state.turn = value;
    }

    this.loadAssets();
  }

  public set phase(value: string) {
    const parsed = Number.parseInt(value);
    if (!isNaN(parsed)) {
      this.state.phase = value;
    }

    this.loadAssets();
  }

  public toggleRenderProvinceCenters() {
    this.state.isRenderingProvinceCenters = !this.state.isRenderingProvinceCenters;
    setLocalStorage("isRenderingProvinceCenters", this.state.isRenderingProvinceCenters);
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

  public unsubscribeFromEvents(subscriber: (event: EMapEngineEvent) => void) {
    this.subscribers.splice(
      this.subscribers.findIndex(s => s === subscriber),
      1,
    )
  }

  private loadAssets() {
    const turn = Number(this.state.turn);
    const phase = Number(this.state.phase);

    Promise.all([
      loadImage("/assets/map_base.jpg"),
      loadImage("/assets/map_provinces.png"),
      loadGameTurn(turn),
      loadWarPhase(turn, phase),
    ]).then(([baseImg, provincesImg, gameTurn, warPhase]) => {
      const offscreen = new OffscreenCanvas(provincesImg.naturalWidth, provincesImg.naturalHeight);
      const offCtx = offscreen.getContext("2d")!;
      offCtx.drawImage(provincesImg, 0, 0);
      const provincesImageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);

      const { canvas: borderCanvas, dilatedMask } = detectBorders(provincesImageData, gameTurn.provinces);

      // findUniqueColors(provincesImageData);

      // const duplicateProvincesCanvas = findDuplicateAresAndHighlightThem(provincesImageData);

      // assignProvinceCentroid(provincesImageData, provincesMap);

      const provincesCenterCanvas = renderProvinceCenters(provincesImageData, gameTurn.provinces);
      const hoverBorderCanvases = buildAllHoverBorders(provincesImageData, gameTurn.provinces);
      const highlightCanvases = buildAllHighlights(provincesImageData, gameTurn.provinces, dilatedMask);

      this.provincesArray = Object.values(gameTurn.provinces);

      this.gameContext = {
        gameTurn,
        warPhase,
      }

      this.assets = {
        baseImg,
        provincesImageData,
        borderCanvas,
        dilatedMask,
        provincesCenterCanvas,
        duplicateProvincesCanvas: null,
        highlightCanvases,
        hoverBorderCanvases,
        selectedColor: null,
        hoveredColor: null,
      };

      this.initScale(baseImg.naturalWidth, baseImg.naturalHeight);
      this.state.isLoading = false;

      this.dispatchEvent(EMapEngineEvent.ASSETS_LOADED);
    });
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

    const {
      baseImg,
      borderCanvas,
      highlightCanvases,
      hoverBorderCanvases,
      duplicateProvincesCanvas,
      provincesCenterCanvas,
      hoveredColor,
      selectedColor,
    } = this.assets;
    const { offsetX, offsetY, scale } = this.mapState;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.drawImage(baseImg, 0, 0);
    ctx.drawImage(borderCanvas, 0, 0);
    if (hoveredColor) {
      const hoverBorder = hoverBorderCanvases.get(hoveredColor);
      if (hoverBorder) {
        ctx.drawImage(hoverBorder, 0, 0);
      }
    }
    if (duplicateProvincesCanvas) {
      ctx.drawImage(duplicateProvincesCanvas, 0, 0);
    }
    if (selectedColor) {
      const highlight = highlightCanvases.get(selectedColor);
      if (highlight) {
        ctx.drawImage(highlight, 0, 0);
      }
    }
    if (provincesCenterCanvas && this.state.isRenderingProvinceCenters) {
      ctx.drawImage(provincesCenterCanvas, 0, 0);
    }
    ctx.restore();
    this.renderArmies(ctx);

    this.state.rafId = requestAnimationFrame(this.renderFrame);
  }

  private renderArmies(ctx: CanvasRenderingContext2D) {
    const gameContext = this.gameContext;
    if (!gameContext) return;

    const { warPhase: { armies }, gameTurn: { provinces } } = gameContext;
    const { offsetX, offsetY, scale } = this.mapState;

    for (const armyId in armies) {
      const army = armies[armyId];
      const province = provinces[army.provinceId];
      if (!province?.center) continue;

      const [worldX, worldY] = province.center;
      const screenX = worldX * scale + offsetX;
      const screenY = worldY * scale + offsetY;

      ctx.save();
      ctx.translate(screenX - ICON_SIZE / 2, screenY - ICON_SIZE / 2);
      ctx.scale(ICON_SCALE, ICON_SCALE);

      // Shadow
      ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;

      // Fill
      ctx.fillStyle = "#ffffff";
      ctx.fill(SHIELD_PATH);

      // Border
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
      ctx.lineWidth = 1;
      ctx.stroke(SHIELD_PATH);

      ctx.restore();
    }
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
        if (this.assets) {
          this.assets.hoveredColor = null;
        }
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
      if (this.assets) {
        this.assets.hoveredColor = null;
      }
      this.canvas.style.cursor = "grab";
      this.dispatchEvent(EMapEngineEvent.PROVINCE_HOVERED);
    }
  }

  private updateHover = (clientX: number, clientY: number) => {
    const state = this.state;
    const assets = this.assets;
    const gameContext = this.gameContext;
    if (!assets || !gameContext) return;

    const { provincesImageData } = assets;
    const { gameTurn: { provinces } } = gameContext;
    const { x, y } = this.getCanvasCoords(clientX, clientY);
    const mapState = this.mapState;

    const imgX = Math.round((x - mapState.offsetX) / mapState.scale);
    const imgY = Math.round((y - mapState.offsetY) / mapState.scale);
    const { width, height } = provincesImageData;

    let province: TProvince | null = null;
    let color: string | null = null;

    if (imgX >= 0 && imgY >= 0 && imgX < width && imgY < height) {
      const pixelColor = getPixelHex(provincesImageData.data, imgX, imgY, width);
      if (pixelColor !== NO_PROVINCE_ID && provinces[pixelColor]) {
        province = provinces[pixelColor];
        color = pixelColor;
      }
    }

    const prev = state.hoveredProvince;
    state.hoveredProvince = province;
    state.hoverClientX = clientX;
    state.hoverClientY = clientY;

    if (prev?.provinceId !== province?.provinceId) {
      assets.hoveredColor = color;
      this.canvas.style.cursor = province ? "pointer" : "grab";
      this.dispatchEvent(EMapEngineEvent.PROVINCE_HOVERED);
    }
  }

  private onClick = (e: MouseEvent) => {
    const state = this.state;
    const assets = this.assets;
    const gameContext = this.gameContext;
    if (state.hasDragged || !assets || !gameContext) {
      return;
    }

    const { provincesImageData } = assets;
    const { gameTurn: { provinces } } = gameContext;
    const { x, y } = this.getCanvasCoords(e.clientX, e.clientY);
    const mapState = this.mapState;

    const imgX = Math.round((x - mapState.offsetX) / mapState.scale);
    const imgY = Math.round((y - mapState.offsetY) / mapState.scale);

    const { width, height } = provincesImageData;

    if (imgX < 0 || imgY < 0 || imgX >= width || imgY >= height) {
      assets.selectedColor = null;
      state.selectedProvince = null;
      this.dispatchEvent(EMapEngineEvent.PROVINCE_SELECTED);
      return;
    }

    const color = getPixelHex(provincesImageData.data, imgX, imgY, width);
    const province = provinces[color];

    if (!province || color === NO_PROVINCE_ID) {
      assets.selectedColor = null;
      state.selectedProvince = null;
      this.dispatchEvent(EMapEngineEvent.PROVINCE_SELECTED);
      return;
    }

    assets.selectedColor = color;
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
