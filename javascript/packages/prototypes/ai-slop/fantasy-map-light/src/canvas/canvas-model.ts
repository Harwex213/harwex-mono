import { PixelBuffer } from "@/canvas/pixel-buffer";
import type { CanvasTransform } from "@/canvas/coordinates";

interface CanvasModelOptions {
    width: number;
    height: number;
    // Базовый слой (загруженная карта) в натуральном разрешении.
    base: HTMLCanvasElement;
    // Прозрачность ОТОБРАЖЕНИЯ слоя провинций (0..1). Влияет только на композицию.
    opacity?: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

// Модель холста: два логических слоя — базовый (карта) снизу и слой провинций
// поверх. Слой провинций живёт в offscreen-буфере натурального разрешения карты.
// Модель — чистая логика (без React): отдаёт композицию в переданный 2D-контекст.
class CanvasModel {
    readonly width: number;
    readonly height: number;
    readonly provinces: PixelBuffer;
    private readonly baseCanvas: HTMLCanvasElement;
    private displayOpacity: number;

    constructor(options: CanvasModelOptions) {
        this.width = options.width;
        this.height = options.height;
        this.baseCanvas = options.base;
        this.displayOpacity = clamp01(options.opacity ?? 1);
        // Буфер провинций всегда в натуральном разрешении карты. По умолчанию
        // полностью white («нет провинции») — создаётся вместе с моделью.
        this.provinces = new PixelBuffer(this.width, this.height);
    }

    get opacity(): number {
        return this.displayOpacity;
    }

    // Прозрачность влияет ТОЛЬКО на отображение — пиксели буфера не трогаются.
    setOpacity(value: number): void {
        this.displayOpacity = clamp01(value);
    }

    // Композиция на видимый контекст: базовый слой, затем слой провинций поверх
    // (source-over) с текущей прозрачностью отображения. Порядок фиксирован —
    // провинции всегда над картой. transform задаёт map → screen.
    render(
        ctx: CanvasRenderingContext2D,
        transform: CanvasTransform,
        displayWidth: number,
        displayHeight: number,
    ): void {
        ctx.clearRect(0, 0, displayWidth, displayHeight);
        // Точные пиксели провинций при масштабировании (без сглаживания краёв).
        ctx.imageSmoothingEnabled = false;

        const drawW = this.width * transform.scale;
        const drawH = this.height * transform.scale;
        const { offsetX, offsetY } = transform;

        ctx.globalAlpha = 1;
        ctx.drawImage(this.baseCanvas, offsetX, offsetY, drawW, drawH);

        ctx.globalAlpha = this.displayOpacity;
        ctx.drawImage(this.provinces.canvas, offsetX, offsetY, drawW, drawH);
        ctx.globalAlpha = 1;
    }
}

export { CanvasModel };
export type { CanvasModelOptions };
