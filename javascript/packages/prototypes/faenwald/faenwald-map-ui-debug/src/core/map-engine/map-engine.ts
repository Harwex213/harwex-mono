import { createGameState, type TArmy, type TGameContext, type TGameState, type TProvince } from "@hw/faenwald-core";
import type { TMapAssets, TMapState } from "./map-types.js";
import { getPixelHex, loadImage } from "./utils.js";
import { detectBorders } from "./detect-borders";
import { buildAllHighlights, buildAllHoverBorders } from "./map-engine-core";
import { renderProvinceCenters } from "./map-engine-debug";
import { getLocalStorage, setLocalStorage } from "../../utils";
import { loadGameContext } from "../../api/api";

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
  selectedEntity: {
    type: "province"
    value: TProvince;
  } | {
    type: "army";
    value: TArmy;
  } | null;
  hoveredEntity: {
    type: "province"
    value: TProvince;
  } | {
    type: "army";
    value: TArmy;
  } | null;
  hoverClientX: number;
  hoverClientY: number;
  isLoading: boolean;
  isRenderingProvinceCenters: boolean;
  turn: string;
  phase: string;
};

enum EMapEngineEvent {
  ASSETS_LOADED = "ASSETS_LOADED",
  ENTITY_SELECTED = "ENTITY_SELECTED",
  ENTITY_HOVERED = "ENTITY_HOVERED",
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
    selectedEntity: null,
    hoveredEntity: null,
    hoverClientX: 0,
    hoverClientY: 0,
    isLoading: false,
    isRenderingProvinceCenters: getLocalStorage("isRenderingProvinceCenters") ?? false,
    turn: getLocalStorage("turn") ?? "4",
    phase: getLocalStorage("phase") ?? "2",
  };
  private assets: TMapAssets | null = null;
  private gameContext: TGameContext | null = null;
  private gameState: TGameState | null = null;
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

  public get selectedEntity() {
    return this.state.selectedEntity;
  }

  public get hoveredEntity() {
    return this.state.hoveredEntity;
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
    Promise.all([
      loadImage("/assets/map_base.jpg"),
      loadImage("/assets/map_provinces.png"),
      loadGameContext(),
    ]).then(([baseImg, provincesImg, gameContext]) => {
      const offscreen = new OffscreenCanvas(provincesImg.naturalWidth, provincesImg.naturalHeight);
      const offCtx = offscreen.getContext("2d")!;
      offCtx.drawImage(provincesImg, 0, 0);
      const provincesImageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);

      const { canvas: borderCanvas, dilatedMask } = detectBorders(provincesImageData, gameContext.provincesRaw);

      // findUniqueColors(provincesImageData);

      // const duplicateProvincesCanvas = findDuplicateAresAndHighlightThem(provincesImageData);

      // assignProvinceCentroid(provincesImageData, provincesMap);

      const provincesCenterCanvas = renderProvinceCenters(provincesImageData, gameContext.provincesRaw);
      const hoverBorderCanvases = buildAllHoverBorders(provincesImageData, gameContext.provincesRaw);
      const highlightCanvases = buildAllHighlights(provincesImageData, gameContext.provincesRaw, dilatedMask);

      this.gameContext = gameContext;
      this.gameState = createGameState(gameContext);

      this.provincesArray = Object.values(this.gameState!.provinces);

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
    const gameState = this.gameState;
    if (!gameState) return;

    const { armies, provinces } = gameState;
    const { offsetX, offsetY, scale } = this.mapState;
    const selectedArmyId = this.state.selectedEntity && this.state.selectedEntity.type === "army"
      ? this.state.selectedEntity.value.id
      : null;
    const hoveredArmyId = this.state.hoveredEntity && this.state.hoveredEntity.type === "army"
      ? this.state.hoveredEntity.value.id
      : null;

    for (const armyId in armies) {
      const army = armies[armyId];
      const province = provinces[army.provinceId];
      if (!province?.center) continue;

      const [worldX, worldY] = province.center;
      const screenX = worldX * scale + offsetX;
      const screenY = worldY * scale + offsetY;
      const isSelected = army.id === selectedArmyId;
      const isHovered = army.id === hoveredArmyId;

      ctx.save();
      ctx.translate(screenX - ICON_SIZE / 2, screenY - ICON_SIZE / 2);
      ctx.scale(ICON_SCALE, ICON_SCALE);

      // Shadow
      if (isSelected) {
        ctx.shadowColor = "gold";
        ctx.shadowBlur = 10;
      } else if (isHovered) {
        ctx.shadowColor = "rgba(186, 161, 10, 0.6)";
        ctx.shadowBlur = 8;
      } else {
        ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
      }

      // Fill
      ctx.fillStyle = isSelected ? "#fff8dc" : isHovered ? "#f0f0f0" : "#ffffff";
      ctx.fill(SHIELD_PATH);

      // Border
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = isSelected ? "gold" : isHovered ? "rgba(186, 161, 10, 0.6)" : "rgba(0, 0, 0, 0.3)";
      ctx.lineWidth = isSelected || isHovered ? 2 : 1;
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

      if (this.state.hoveredEntity) {
        state.hoveredEntity = null;
        if (this.assets) {
          this.assets.hoveredColor = null;
        }
        this.dispatchEvent(EMapEngineEvent.ENTITY_HOVERED);
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
    if (this.state.hoveredEntity) {
      this.state.hoveredEntity = null;
      if (this.assets) {
        this.assets.hoveredColor = null;
      }
      this.canvas.style.cursor = "grab";
      this.dispatchEvent(EMapEngineEvent.ENTITY_HOVERED);
    }
  }

  private updateHover = (clientX: number, clientY: number) => {
    const state = this.state;
    const assets = this.assets;
    const gameState = this.gameState;
    if (!assets || !gameState) return;

    const { x, y } = this.getCanvasCoords(clientX, clientY);

    // Army hover takes priority
    const army = this.findArmyAtScreen(x, y);
    const prevHoveredEntity = state.hoveredEntity;

    if (army) {
      state.hoverClientX = clientX;
      state.hoverClientY = clientY;

      const isNewHover = prevHoveredEntity === null ||
        prevHoveredEntity.type !== "army" ||
        (prevHoveredEntity.type === "army" && prevHoveredEntity.value.id !== army.id);

      if (isNewHover) {
        state.hoveredEntity = {
          type: "army",
          value: army,
        };
        assets.hoveredColor = null;
        this.canvas.style.cursor = "pointer";
        this.dispatchEvent(EMapEngineEvent.ENTITY_HOVERED);
      }

      return;
    }

    // Province hover
    const { provincesImageData } = assets;
    const { provinces } = gameState;
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

    if (province && color) {
      state.hoverClientX = clientX;
      state.hoverClientY = clientY;

      const isNewHover = prevHoveredEntity === null ||
        prevHoveredEntity.type !== "province" ||
        (prevHoveredEntity.type === "province" && prevHoveredEntity.value.provinceId !== province.provinceId);

      if (isNewHover) {
        state.hoveredEntity = {
          type: "province",
          value: province,
        };
        assets.hoveredColor = color;
        this.canvas.style.cursor = province ? "pointer" : "grab";
        this.dispatchEvent(EMapEngineEvent.ENTITY_HOVERED);
      }

      return;
    }

    if (prevHoveredEntity !== null) {
      state.hoveredEntity = null;
      assets.hoveredColor = null;
      this.canvas.style.cursor = "grab";
      this.dispatchEvent(EMapEngineEvent.ENTITY_HOVERED);
    }
  }

  private findArmyAtScreen(screenX: number, screenY: number): TArmy | null {
    const gameState = this.gameState;
    if (!gameState) return null;

    const { armies, provinces } = gameState;
    const { offsetX, offsetY, scale } = this.mapState;
    const halfSize = ICON_SIZE / 2;

    for (const armyId in armies) {
      const army = armies[armyId];
      const province = provinces[army.provinceId];
      if (!province?.center) continue;

      const [worldX, worldY] = province.center;
      const cx = worldX * scale + offsetX;
      const cy = worldY * scale + offsetY;

      if (
        screenX >= cx - halfSize && screenX <= cx + halfSize &&
        screenY >= cy - halfSize && screenY <= cy + halfSize
      ) {
        return army;
      }
    }

    return null;
  }

  private onClick = (e: MouseEvent) => {
    const state = this.state;
    const assets = this.assets;
    const gameState = this.gameState;
    if (state.hasDragged || !assets || !gameState) {
      return;
    }

    const { x, y } = this.getCanvasCoords(e.clientX, e.clientY);

    // Army hit-test first (rendered on top)
    const army = this.findArmyAtScreen(x, y);
    if (army) {
      const shouldSelect = state.selectedEntity === null ||
        state.selectedEntity.type !== "army" ||
        (state.selectedEntity?.type === "army" && state.selectedEntity.value.id !== army.id);

      if (shouldSelect) {
        state.selectedEntity = {
          type: "army",
          value: army,
        }
        assets.selectedColor = null;
        this.dispatchEvent(EMapEngineEvent.ENTITY_SELECTED);
      }
      return;
    }

    const { provincesImageData } = assets;
    const { provinces } = gameState;
    const mapState = this.mapState;

    const imgX = Math.round((x - mapState.offsetX) / mapState.scale);
    const imgY = Math.round((y - mapState.offsetY) / mapState.scale);

    const { width, height } = provincesImageData;

    if (imgX < 0 || imgY < 0 || imgX >= width || imgY >= height) {
      if (this.selectedEntity !== null) {
        assets.selectedColor = null;
        state.selectedEntity = null;
        this.dispatchEvent(EMapEngineEvent.ENTITY_SELECTED);
      }
      return;
    }

    const color = getPixelHex(provincesImageData.data, imgX, imgY, width);
    const province = provinces[color];

    if (!province || color === NO_PROVINCE_ID) {
      if (this.selectedEntity !== null) {
        assets.selectedColor = null;
        state.selectedEntity = null;
        this.dispatchEvent(EMapEngineEvent.ENTITY_SELECTED);
      }

      return;
    }

    const shouldSelect = state.selectedEntity === null ||
      state.selectedEntity.type !== "province" ||
      (state.selectedEntity.type === "province" && state.selectedEntity.value.provinceId !== province.provinceId);

    if (shouldSelect) {
      assets.selectedColor = color;
      state.selectedEntity = {
        type: "province",
        value: province,
      };
      this.dispatchEvent(EMapEngineEvent.ENTITY_SELECTED);
    }
  }

  private dispatchEvent(event: EMapEngineEvent) {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }
}

export { MapEngine, EMapEngineEvent }
