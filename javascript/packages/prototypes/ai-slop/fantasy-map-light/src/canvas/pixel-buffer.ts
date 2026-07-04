import { WHITE, type RgbaColor } from "@/canvas/color";

// Offscreen-буфер слоя провинций в НАТУРАЛЬНОМ разрешении карты.
//
// Пиксельные данные (этот буфер) отделены от отображения: масштаб/размер вывода
// на экране и прозрачность отображения никак не влияют на содержимое. Хранится
// в отдельном (не вставленном в DOM) <canvas> — фактически offscreen. Даёт API
// чтения/записи пикселя(ей) по координатам пикселей карты и точную заливку без
// сглаживания (кисть инструмента «Рисовать»).
class PixelBuffer {
    readonly width: number;
    readonly height: number;
    private readonly canvasEl: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;

    constructor(width: number, height: number, fillColor: RgbaColor = WHITE) {
        if (width <= 0 || height <= 0) {
            throw new Error(`Invalid buffer size: ${width}×${height}`);
        }
        this.width = width;
        this.height = height;
        this.canvasEl = document.createElement("canvas");
        this.canvasEl.width = width;
        this.canvasEl.height = height;
        const ctx = this.canvasEl.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
            throw new Error("2D context is unavailable for province buffer");
        }
        this.ctx = ctx;
        // Дефолтное состояние буфера явно определено — сплошная заливка fillColor.
        this.fill(fillColor);
    }

    // Источник для композиции и экспорта. Только чтение — не мутировать снаружи.
    get canvas(): HTMLCanvasElement {
        return this.canvasEl;
    }

    contains(x: number, y: number): boolean {
        const px = Math.floor(x);
        const py = Math.floor(y);
        return px >= 0 && px < this.width && py >= 0 && py < this.height;
    }

    // Полная заливка сплошным цветом. Непрозрачный цвет пишется точно (без AA).
    fill(color: RgbaColor): void {
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a / 255})`;
        this.ctx.fillRect(0, 0, this.width, this.height);
    }

    // Цвет пикселя карты; null если координата вне карты (out-of-bounds).
    getPixel(x: number, y: number): RgbaColor | null {
        if (!this.contains(x, y)) {
            return null;
        }
        const { data } = this.ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1);
        return { r: data[0], g: data[1], b: data[2], a: data[3] };
    }

    // Точная заливка прямоугольной области (клипится по границам карты).
    // Пиксели ровно заданного цвета, без сглаживания (putImageData не смешивает).
    // Возвращает true, если хотя бы один пиксель попал в границы и был записан.
    fillRect(x: number, y: number, w: number, h: number, color: RgbaColor): boolean {
        const x0 = Math.max(0, Math.floor(x));
        const y0 = Math.max(0, Math.floor(y));
        const x1 = Math.min(this.width, Math.floor(x + w));
        const y1 = Math.min(this.height, Math.floor(y + h));
        const rw = x1 - x0;
        const rh = y1 - y0;
        if (rw <= 0 || rh <= 0) {
            return false;
        }
        const image = this.ctx.createImageData(rw, rh);
        const { data } = image;
        for (let i = 0; i < data.length; i += 4) {
            data[i] = color.r;
            data[i + 1] = color.g;
            data[i + 2] = color.b;
            data[i + 3] = color.a;
        }
        this.ctx.putImageData(image, x0, y0);
        return true;
    }

    // Квадратный штамп кисти размера `size` (в пикселях карты) с центром в (cx, cy).
    // Клипится по границам — рисование за пределами карты не падает.
    // Возвращает true, если штамп что-то записал (центр/часть попали в карту).
    stamp(cx: number, cy: number, size: number, color: RgbaColor): boolean {
        const half = size / 2;
        return this.fillRect(cx - half, cy - half, size, size, color);
    }

    // Полный снимок буфера для экспорта/сканирования (натуральное разрешение).
    snapshot(): ImageData {
        return this.ctx.getImageData(0, 0, this.width, this.height);
    }

    // Восстанавливает буфер из ранее снятого снимка (Undo/Redo). Размеры снимка
    // должны совпадать с размерами буфера. Пиксели пишутся точно (без AA).
    restore(image: ImageData): void {
        this.ctx.putImageData(image, 0, 0);
    }
}

export { PixelBuffer };
