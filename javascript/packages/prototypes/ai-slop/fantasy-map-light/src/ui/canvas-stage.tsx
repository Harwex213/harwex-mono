import { FC, memo, useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from "react";
import { CanvasModel } from "@/canvas/canvas-model";
import { isWhite, rgbaToHex, WHITE, type RgbaColor } from "@/canvas/color";
import {
    clampTransform,
    fitTransform,
    screenToMap,
    zoomAt,
    type CanvasTransform,
} from "@/canvas/coordinates";
import { EditHistory, type EditState } from "@/canvas/history";
import { loadMapImage } from "@/canvas/load-map-image";
import { ProvinceRegistry } from "@/provinces/province-registry";
import { collectUsedHexes, exportProvinces } from "@/provinces/export";
import classes from "./canvas-stage.module.css";

type Tool = "draw" | "eraser" | "eyedropper";

const IDENTITY_TRANSFORM: CanvasTransform = { scale: 1, offsetX: 0, offsetY: 0 };
// Верхний предел масштаба: сколько CSS-пикселей на 1 пиксель карты. Нижний
// предел — «карта целиком» (fit), считается динамически под размер вьюпорта.
const MAX_SCALE = 40;

// Холст платформы Faenwald: загрузка PNG-карты, двухслойный рендер
// (карта + слой провинций), инструменты «Рисовать»/«Ластик»/«Пипетка», зум
// вокруг курсора, Undo/Redo и cleanup «мёртвых» провинций, экспорт (PNG + JSON).
// Модель холста, реестр провинций, история и transform живут вне React (refs);
// React-состояние — только UI (инструмент, прозрачность, статус).
const CanvasStage: FC = memo(() => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const modelRef = useRef<CanvasModel | null>(null);
    const registryRef = useRef<ProvinceRegistry>(new ProvinceRegistry());
    const historyRef = useRef<EditHistory>(new EditHistory());
    const transformRef = useRef<CanvasTransform>(IDENTITY_TRANSFORM);
    // Масштаб «карта целиком» под текущий вьюпорт (нижний предел зума).
    const fitScaleRef = useRef<number>(1);
    // Пользователь менял зум? Если нет — при ресайзе холст переподгоняется (fit).
    const viewAdjustedRef = useRef<boolean>(false);
    // Зеркало activeColor для стабильных обработчиков (keydown/Undo/Redo).
    const activeColorRef = useRef<RgbaColor | null>(null);
    // Состояние текущего штриха (между pointerdown и pointerup).
    const strokeRef = useRef<{
        active: boolean;
        dirty: boolean;
        color: RgbaColor;
        lastX: number;
        lastY: number;
    }>({ active: false, dirty: false, color: WHITE, lastX: 0, lastY: 0 });

    const [opacity, setOpacity] = useState(0.6);
    const [tool, setTool] = useState<Tool>("draw");
    const [brushSize, setBrushSize] = useState(24);
    const [activeColor, setActiveColor] = useState<RgbaColor | null>(null);
    const [provinceCount, setProvinceCount] = useState(0);
    // Инкремент форсирует пере-рендер после смены модели (модель вне React).
    const [modelVersion, setModelVersion] = useState(0);
    const [status, setStatus] = useState<string>("Загрузите PNG-карту, чтобы начать");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        activeColorRef.current = activeColor;
    }, [activeColor]);

    const render = useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        const model = modelRef.current;
        if (!canvas || !container) {
            return;
        }

        const rect = container.getBoundingClientRect();
        const cssWidth = Math.max(1, Math.floor(rect.width));
        const cssHeight = Math.max(1, Math.floor(rect.height));
        const dpr = window.devicePixelRatio || 1;
        const pixelWidth = Math.round(cssWidth * dpr);
        const pixelHeight = Math.round(cssHeight * dpr);
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return;
        }

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (!model) {
            // Пустое состояние до загрузки карты.
            ctx.clearRect(0, 0, cssWidth, cssHeight);
            return;
        }

        // «Карта целиком» — нижний предел зума, пересчитывается под вьюпорт.
        const fit = fitTransform(model.width, model.height, cssWidth, cssHeight);
        fitScaleRef.current = fit.scale;

        // Без пользовательского зума холст всегда подогнан под вьюпорт (fit).
        // С зумом — сохраняем transform, но приводим к актуальным пределам.
        const transform = viewAdjustedRef.current
            ? clampTransform(
                  transformRef.current,
                  fit.scale,
                  MAX_SCALE,
                  cssWidth,
                  cssHeight,
                  model.width,
                  model.height,
              )
            : fit;
        transformRef.current = transform;

        model.setOpacity(opacity);
        model.render(ctx, transform, cssWidth, cssHeight);
    }, [opacity, modelVersion]);

    useEffect(() => {
        render();
    }, [render]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }
        const observer = new ResizeObserver(() => render());
        observer.observe(container);
        return () => observer.disconnect();
    }, [render]);

    // Ctrl/Cmd + колесо (и pinch-zoom тачпада — он приходит как wheel с ctrlKey):
    // зум вокруг курсора. Нативный слушатель с passive:false, чтобы preventDefault
    // отменял зум страницы браузера. Точка под курсором остаётся на месте.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const onWheel = (event: WheelEvent) => {
            if (!(event.ctrlKey || event.metaKey)) {
                return;
            }
            event.preventDefault();
            const model = modelRef.current;
            if (!model) {
                return;
            }
            const rect = canvas.getBoundingClientRect();
            const cssWidth = Math.max(1, Math.floor(rect.width));
            const cssHeight = Math.max(1, Math.floor(rect.height));
            const factor = Math.exp(-event.deltaY * 0.0015);
            transformRef.current = zoomAt(
                transformRef.current,
                event.clientX - rect.left,
                event.clientY - rect.top,
                factor,
                fitScaleRef.current,
                MAX_SCALE,
                cssWidth,
                cssHeight,
                model.width,
                model.height,
            );
            viewAdjustedRef.current = true;
            render();
        };
        canvas.addEventListener("wheel", onWheel, { passive: false });
        return () => canvas.removeEventListener("wheel", onWheel);
    }, [render]);

    // Экранные координаты события → пиксели карты (float) через актуальный
    // transform (учитывает зум).
    const eventToMap = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return null;
        }
        const rect = canvas.getBoundingClientRect();
        return screenToMap(
            transformRef.current,
            event.clientX - rect.left,
            event.clientY - rect.top,
        );
    }, []);

    // Снимок текущего состояния (пиксели + реестр) для истории Undo/Redo.
    const captureState = useCallback((): EditState | null => {
        const model = modelRef.current;
        if (!model) {
            return null;
        }
        return {
            image: model.provinces.snapshot(),
            provinces: registryRef.current.snapshot(),
        };
    }, []);

    // Применяет состояние из истории: восстанавливает пиксели и реестр. Если
    // активный цвет больше не существует — сбрасываем его (рисовать нечем).
    const applyState = useCallback(
        (state: EditState) => {
            const model = modelRef.current;
            if (!model) {
                return;
            }
            model.provinces.restore(state.image);
            registryRef.current.restore(state.provinces);
            setProvinceCount(registryRef.current.size);
            const active = activeColorRef.current;
            if (active && !registryRef.current.has(active)) {
                setActiveColor(null);
            }
            render();
        },
        [render],
    );

    // Cleanup «мёртвых» провинций: провинция без единого пикселя удаляется из
    // реестра (и потому не попадёт в экспорт). Если удалён активный цвет —
    // сбрасываем его, чтобы не рисовать несуществующей провинцией.
    const reconcileRegistry = useCallback(() => {
        const model = modelRef.current;
        if (!model) {
            return;
        }
        const alive = collectUsedHexes(model.provinces);
        const removed = registryRef.current.prune(alive);
        setProvinceCount(registryRef.current.size);
        const active = activeColorRef.current;
        if (removed.length > 0 && active && !registryRef.current.has(active)) {
            setActiveColor(null);
            setStatus("Активная провинция исчезла (не осталось пикселей)");
        }
    }, []);

    const doUndo = useCallback(() => {
        const current = captureState();
        if (!current) {
            return;
        }
        const previous = historyRef.current.undo(current);
        if (!previous) {
            setStatus("Отменять нечего");
            return;
        }
        applyState(previous);
        setStatus("Отменено (Undo)");
    }, [captureState, applyState]);

    const doRedo = useCallback(() => {
        const current = captureState();
        if (!current) {
            return;
        }
        const next = historyRef.current.redo(current);
        if (!next) {
            setStatus("Повторять нечего");
            return;
        }
        applyState(next);
        setStatus("Повторено (Redo)");
    }, [captureState, applyState]);

    // Ctrl/Cmd+Z — Undo, Ctrl/Cmd+Shift+Z (или Ctrl+Y) — Redo.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey)) {
                return;
            }
            const key = event.key.toLowerCase();
            if (key === "z") {
                event.preventDefault();
                if (event.shiftKey) {
                    doRedo();
                } else {
                    doUndo();
                }
            } else if (key === "y") {
                event.preventDefault();
                doRedo();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [doUndo, doRedo]);

    // Ставит штампы кисти вдоль отрезка (from → to), чтобы быстрые движения не
    // оставляли разрывов. Пиксели пишутся ровно `color` (без сглаживания).
    // Возвращает true, если хоть один штамп попал в границы карты.
    const paintSegment = useCallback(
        (color: RgbaColor, fromX: number, fromY: number, toX: number, toY: number) => {
            const model = modelRef.current;
            if (!model) {
                return false;
            }
            const dx = toX - fromX;
            const dy = toY - fromY;
            const distance = Math.hypot(dx, dy);
            const step = Math.max(1, brushSize / 3);
            const count = Math.max(1, Math.ceil(distance / step));
            let painted = false;
            for (let i = 0; i <= count; i += 1) {
                const t = i / count;
                // Клип по границам карты — рисование за пределами не падает.
                if (
                    model.provinces.stamp(
                        fromX + dx * t,
                        fromY + dy * t,
                        brushSize,
                        color,
                    )
                ) {
                    painted = true;
                }
            }
            render();
            return painted;
        },
        [brushSize, render],
    );

    const handlePointerDown = useCallback(
        (event: ReactPointerEvent<HTMLCanvasElement>) => {
            const model = modelRef.current;
            const point = eventToMap(event);
            if (!model || !point) {
                return;
            }

            if (tool === "eyedropper") {
                const color = model.provinces.getPixel(point.x, point.y);
                if (!color) {
                    setStatus("Пипетка: клик вне карты");
                    return;
                }
                if (isWhite(color)) {
                    // white = «нет провинции» — цвет не адаптируется.
                    setStatus("Пипетка: white — здесь нет провинции");
                    return;
                }
                // Регистрируем на случай, если провинция ещё неизвестна реестру.
                registryRef.current.register(color);
                setProvinceCount(registryRef.current.size);
                setActiveColor(color);
                setStatus(`Пипетка: выбран цвет ${rgbaToHex(color)}`);
                return;
            }

            // «Ластик» рисует white (стирает провинции), «Рисовать» — активным цветом.
            const color = tool === "eraser" ? WHITE : activeColor;
            if (!color) {
                setStatus("Сначала создайте провинцию (кнопка «Новая провинция»)");
                return;
            }

            event.currentTarget.setPointerCapture(event.pointerId);
            // Фиксируем состояние ДО штриха для Undo.
            const before = captureState();
            if (before) {
                historyRef.current.begin(before);
            }
            strokeRef.current = {
                active: true,
                dirty: false,
                color,
                lastX: point.x,
                lastY: point.y,
            };
            strokeRef.current.dirty = paintSegment(color, point.x, point.y, point.x, point.y);
        },
        [tool, activeColor, eventToMap, captureState, paintSegment],
    );

    const handlePointerMove = useCallback(
        (event: ReactPointerEvent<HTMLCanvasElement>) => {
            const stroke = strokeRef.current;
            if (!stroke.active) {
                return;
            }
            const point = eventToMap(event);
            if (!point) {
                return;
            }
            const painted = paintSegment(
                stroke.color,
                stroke.lastX,
                stroke.lastY,
                point.x,
                point.y,
            );
            stroke.dirty = stroke.dirty || painted;
            stroke.lastX = point.x;
            stroke.lastY = point.y;
        },
        [eventToMap, paintSegment],
    );

    const endStroke = useCallback(
        (event: ReactPointerEvent<HTMLCanvasElement>) => {
            const stroke = strokeRef.current;
            if (!stroke.active) {
                return;
            }
            stroke.active = false;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
            }
            if (stroke.dirty) {
                // Штрих что-то изменил: cleanup мёртвых провинций + запись в историю.
                reconcileRegistry();
                historyRef.current.commit(true);
            } else {
                // Штрих ничего не нарисовал (вне карты) — не засоряем историю.
                historyRef.current.cancel();
            }
        },
        [reconcileRegistry],
    );

    const handleNewProvince = useCallback(() => {
        if (!modelRef.current) {
            setStatus("Сначала загрузите карту");
            return;
        }
        const color = registryRef.current.generateUniqueColor();
        const meta = registryRef.current.register(color);
        setProvinceCount(registryRef.current.size);
        setActiveColor(color);
        setTool("draw");
        setStatus(`Новая провинция ${meta.provinceName} · ${meta.provinceId}`);
    }, []);

    const handleFileChange = useCallback(
        async (event: ChangeEvent<HTMLInputElement>) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            // Сбрасываем value, чтобы повторный выбор того же файла сработал.
            input.value = "";
            if (!file) {
                return;
            }

            setLoading(true);
            setStatus("Загрузка карты…");
            try {
                const { canvas, width, height } = await loadMapImage(file);
                // Новая карта → новая модель (слой провинций пересоздаётся под
                // width×height, целиком white), чистый реестр и история, сброс зума.
                modelRef.current = new CanvasModel({ width, height, base: canvas, opacity });
                registryRef.current = new ProvinceRegistry();
                historyRef.current = new EditHistory();
                viewAdjustedRef.current = false;
                setActiveColor(null);
                setProvinceCount(0);
                setModelVersion((version) => version + 1);
                setStatus(`Карта ${width}×${height} загружена`);
            } catch (error) {
                setStatus(
                    `Ошибка загрузки: ${error instanceof Error ? error.message : "неизвестная"}`,
                );
            } finally {
                setLoading(false);
            }
        },
        [opacity],
    );

    const handleDownload = useCallback(async () => {
        const model = modelRef.current;
        if (!model) {
            setStatus("Нечего скачивать: карта не загружена");
            return;
        }
        setStatus("Формирование файлов…");
        try {
            const { provinceCount: count } = await exportProvinces(
                model.provinces,
                registryRef.current,
            );
            setStatus(`Скачано: provinces.png + provinces.json (${count} провинций)`);
        } catch (error) {
            setStatus(
                `Ошибка экспорта: ${error instanceof Error ? error.message : "неизвестная"}`,
            );
        }
    }, []);

    const hasModel = modelRef.current !== null;
    const activeHex = activeColor ? rgbaToHex(activeColor) : null;

    return (
        <div className={classes.stage}>
            <div className={classes.toolbar}>
                <label className={classes.control}>
                    <span>Карта (PNG)</span>
                    <input
                        type="file"
                        accept="image/png,.png"
                        onChange={handleFileChange}
                        disabled={loading}
                    />
                </label>

                <label className={classes.control}>
                    <span>Прозрачность</span>
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={opacity}
                        onChange={(event) => setOpacity(Number(event.target.value))}
                    />
                    <span>{Math.round(opacity * 100)}%</span>
                </label>

                <div className={classes.control} role="group" aria-label="Инструмент">
                    <button
                        type="button"
                        className={tool === "draw" ? classes.toolActive : classes.tool}
                        onClick={() => setTool("draw")}
                        disabled={!hasModel}
                    >
                        Рисовать
                    </button>
                    <button
                        type="button"
                        className={tool === "eraser" ? classes.toolActive : classes.tool}
                        onClick={() => setTool("eraser")}
                        disabled={!hasModel}
                    >
                        Ластик
                    </button>
                    <button
                        type="button"
                        className={tool === "eyedropper" ? classes.toolActive : classes.tool}
                        onClick={() => setTool("eyedropper")}
                        disabled={!hasModel}
                    >
                        Пипетка
                    </button>
                </div>

                <label className={classes.control}>
                    <span>Кисть</span>
                    <input
                        type="range"
                        min={1}
                        max={200}
                        step={1}
                        value={brushSize}
                        onChange={(event) => setBrushSize(Number(event.target.value))}
                    />
                    <span>{brushSize}px</span>
                </label>

                <div className={classes.control} role="group" aria-label="История">
                    <button
                        type="button"
                        className={classes.tool}
                        onClick={doUndo}
                        disabled={!hasModel}
                        title="Ctrl/Cmd+Z"
                    >
                        Отменить
                    </button>
                    <button
                        type="button"
                        className={classes.tool}
                        onClick={doRedo}
                        disabled={!hasModel}
                        title="Ctrl/Cmd+Shift+Z"
                    >
                        Повторить
                    </button>
                </div>

                <button
                    type="button"
                    className={classes.tool}
                    onClick={handleNewProvince}
                    disabled={!hasModel}
                >
                    Новая провинция
                </button>

                <span className={classes.swatch} aria-label="Активный цвет">
                    <span
                        className={classes.swatchBox}
                        style={{ background: activeHex ?? "transparent" }}
                    />
                    {activeHex ?? "нет цвета"}
                </span>

                <button
                    type="button"
                    className={classes.tool}
                    onClick={handleDownload}
                    disabled={!hasModel}
                >
                    Скачать
                </button>

                <span className={classes.readout}>
                    {hasModel ? `провинций: ${provinceCount} · ` : ""}
                    {status}
                </span>
            </div>

            <div ref={containerRef} className={classes.viewport}>
                <canvas
                    ref={canvasRef}
                    className={classes.canvas}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={endStroke}
                    onPointerCancel={endStroke}
                />
            </div>
        </div>
    );
});

export { CanvasStage };
