// Загрузка и декодирование PNG-карты. Валидирует тип файла, декодирует
// изображение и растеризует его в offscreen-<canvas> натурального размера —
// готовый базовый слой для CanvasModel.
//
// Чистая асинхронная функция без побочных эффектов на UI. Ошибки (не-PNG,
// битый файл, недоступный контекст) выбрасываются как Error и обрабатываются
// вызывающим кодом — приложение не должно падать.

interface DecodedMap {
    canvas: HTMLCanvasElement;
    width: number;
    height: number;
}

const isPngFile = (file: File): boolean =>
    file.type === "image/png" || /\.png$/i.test(file.name);

// Растеризует декодированный источник в <canvas> натурального размера.
const rasterize = (
    source: CanvasImageSource,
    width: number,
    height: number,
): HTMLCanvasElement => {
    if (width <= 0 || height <= 0) {
        throw new Error(`Invalid image size: ${width}×${height}`);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("2D context is unavailable for base map layer");
    }
    ctx.drawImage(source, 0, 0);
    return canvas;
};

// Резервный путь декодирования через HTMLImageElement + object URL — для
// окружений без createImageBitmap.
const decodeViaImageElement = (file: File): Promise<DecodedMap> =>
    new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            try {
                const width = image.naturalWidth;
                const height = image.naturalHeight;
                resolve({ canvas: rasterize(image, width, height), width, height });
            } catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)));
            } finally {
                URL.revokeObjectURL(url);
            }
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Failed to decode image"));
        };
        image.src = url;
    });

// Загружает PNG-файл карты и возвращает базовый слой в натуральном разрешении.
// Не-PNG отклоняется до декодирования; ошибки декодирования пробрасываются.
const loadMapImage = async (file: File): Promise<DecodedMap> => {
    if (!isPngFile(file)) {
        throw new Error("Неподдерживаемый тип файла: ожидается PNG");
    }

    if (typeof createImageBitmap === "function") {
        let bitmap: ImageBitmap | null = null;
        try {
            bitmap = await createImageBitmap(file);
            const { width, height } = bitmap;
            return { canvas: rasterize(bitmap, width, height), width, height };
        } catch {
            // Некоторые окружения не декодируют PNG через createImageBitmap —
            // пробуем резервный путь; настоящий битый файл упадёт и там.
            return decodeViaImageElement(file);
        } finally {
            bitmap?.close();
        }
    }

    return decodeViaImageElement(file);
};

export { loadMapImage, isPngFile };
export type { DecodedMap };
