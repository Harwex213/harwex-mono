// Контракт координат экран ↔ пиксели карты.
//
// screen — координаты в CSS-пикселях ОТНОСИТЕЛЬНО элемента холста (0,0 = левый
// верхний угол элемента). map — координаты в натуральных пикселях карты.
//
// Прямое преобразование (map → screen):  s = m * scale + offset
// Обратное (screen → map):                m = (s - offset) / scale
//
// scale — сколько CSS-пикселей отображения приходится на 1 пиксель карты
// (единый по осям, чтобы сохранить пропорции). offsetX/offsetY — сдвиг карты
// внутри области отображения (letterbox-центрирование).
interface CanvasTransform {
    scale: number;
    offsetX: number;
    offsetY: number;
}

interface Point {
    x: number;
    y: number;
}

// Вписывает карту (mapWidth×mapHeight) в область отображения с сохранением
// пропорций и центрированием (contain). Никакого пана/зума.
const fitTransform = (
    mapWidth: number,
    mapHeight: number,
    displayWidth: number,
    displayHeight: number,
): CanvasTransform => {
    const scale = Math.min(displayWidth / mapWidth, displayHeight / mapHeight);
    return {
        scale,
        offsetX: (displayWidth - mapWidth * scale) / 2,
        offsetY: (displayHeight - mapHeight * scale) / 2,
    };
};

const screenToMap = (transform: CanvasTransform, x: number, y: number): Point => ({
    x: (x - transform.offsetX) / transform.scale,
    y: (y - transform.offsetY) / transform.scale,
});

const mapToScreen = (transform: CanvasTransform, x: number, y: number): Point => ({
    x: x * transform.scale + transform.offsetX,
    y: y * transform.scale + transform.offsetY,
});

// Точка внутри карты? Координаты за пределами — предсказуемо out-of-bounds
// (рисование/пипетка за пределами карты не должны падать).
const isInsideMap = (
    mapWidth: number,
    mapHeight: number,
    x: number,
    y: number,
): boolean => x >= 0 && x < mapWidth && y >= 0 && y < mapHeight;

const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));

// Приводит transform к допустимому виду: масштаб в [minScale, maxScale], а сдвиг
// так, чтобы карта не «улетала» из области отображения. Если по оси карта уже
// её области — центрируем; иначе не даём образоваться пустым полям по краям.
const clampTransform = (
    transform: CanvasTransform,
    minScale: number,
    maxScale: number,
    displayWidth: number,
    displayHeight: number,
    mapWidth: number,
    mapHeight: number,
): CanvasTransform => {
    const scale = clamp(transform.scale, minScale, maxScale);
    const drawW = mapWidth * scale;
    const drawH = mapHeight * scale;
    const axis = (offset: number, draw: number, display: number): number =>
        draw <= display
            ? (display - draw) / 2 // карта меньше области → центрируем
            : clamp(offset, display - draw, 0); // иначе прижимаем к краям
    return {
        scale,
        offsetX: axis(transform.offsetX, drawW, displayWidth),
        offsetY: axis(transform.offsetY, drawH, displayHeight),
    };
};

// Масштабирование «вокруг курсора»: точка карты под курсором остаётся на месте.
// factor > 1 приближает, < 1 отдаляет. Результат приводится clampTransform.
const zoomAt = (
    transform: CanvasTransform,
    cursorX: number,
    cursorY: number,
    factor: number,
    minScale: number,
    maxScale: number,
    displayWidth: number,
    displayHeight: number,
    mapWidth: number,
    mapHeight: number,
): CanvasTransform => {
    const nextScale = clamp(transform.scale * factor, minScale, maxScale);
    const map = screenToMap(transform, cursorX, cursorY);
    return clampTransform(
        {
            scale: nextScale,
            offsetX: cursorX - map.x * nextScale,
            offsetY: cursorY - map.y * nextScale,
        },
        minScale,
        maxScale,
        displayWidth,
        displayHeight,
        mapWidth,
        mapHeight,
    );
};

export { fitTransform, screenToMap, mapToScreen, isInsideMap, clampTransform, zoomAt };
export type { CanvasTransform, Point };
