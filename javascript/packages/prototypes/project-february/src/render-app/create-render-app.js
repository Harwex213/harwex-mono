import { Application, Assets } from "pixi.js";
import { Viewport } from "pixi-viewport";

/**
 * SAVE STATE
 * https://app.excalidraw.com/s/43OtgB2sfjj/7uSv7LD9N6b
 * https://pixijs.download/release/docs/scene.Graphics.html
 * https://pixijs.download/release/docs/rendering_renderers_shared_state_const.ts.html
 * https://github.dev/pixijs/pixijs/blob/dev/src/rendering/renderers/shared/texture/const.ts
 * https://pixijs.com/8.x/examples/masks/filter
 * https://www.aseprite.org/
 * https://www.google.com/search?q=color+picker
 */

const createViewport = (app) => {
    const viewport = new Viewport({
        passiveWheel: false,
        events: app.renderer.events,
        ticker: app.ticker,
        disableOnContextMenu: true,
    });

    viewport
        .drag({
            wheel: false,
            mouseButtons: "all",
            factor: 1,
        })
        .pinch()
        .decelerate()
        .wheel({
            smooth: 3.5,
        })
        // .setZoom(0.1)
        .clampZoom({
            minScale: 0.01,
            maxScale: 3,
        });

    return viewport;
};

const loadSpriteSheet = () => Assets.load("/spritesheet.json");

const createRenderApp = async () => {
    const app = new Application();
    const [sheet] = await Promise.all([
        loadSpriteSheet(),
        app.init({
            background: "#000000",
            resizeTo: window,
            // preference: "webgl",
            antialias: false,
            autoDensity: true,
            useBackBuffer: true,
            resolution: window.devicePixelRatio,
        }),
    ]);
    const viewport = createViewport(app);

    app.stage.addChild(viewport);

    return {
        app,
        viewport,
        sheet,
    };
};

export { createRenderApp };
