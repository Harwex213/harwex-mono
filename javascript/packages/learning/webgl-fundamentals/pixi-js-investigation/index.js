import PIXI from "./pixi.js";

const { Application, Assets, Sprite, Point, EventSystem } = PIXI;

console.log(Application);

// Asynchronous IIFE
(async () => {
    // Create a PixiJS application.
    const app = new Application();

    // Intialize the application.
    await app.init({ background: "#1099bb", resizeTo: window });

    // Then adding the application's canvas to the DOM body.
    document.body.appendChild(app.canvas);

    // Load the bunny texture.
    const texture = await Assets.load("https://pixijs.com/assets/bunny.png");

    // Create a new Sprite from an image path.
    const bunny = new Sprite(texture);

    let i = 0;
    const bunnies = [...Array(50)].map(() => {
        const bunny = new Sprite(texture);
        bunny.anchor.set(0.5);
        bunny.tint = 0x00ff00;
        bunny.x = i;
        bunny.y = 100;
        i += 10;
        return bunny;
    });

    app.stage.addChild(...bunnies);

    const eventSystem = new EventSystem(app.renderer);
    eventSystem.setTargetElement(app.canvas);

    // app.ticker.add((time) => {
    //     console.log(time.deltaTime);
    // });

    let clickNumber = 0;

    document.body.addEventListener("click", () => {
        if (clickNumber === 0) {
            try {
                for (let j = 2; j < 100; j += 2) {
                    const bunny = app.stage.children[j];
                    bunny.destroy();
                }
            } catch (e) {}
        }

        if (clickNumber === 1) {
            i = 0;
            const bunnies2 = [...Array(50)].map(() => {
                const bunny = new Sprite(texture);
                bunny.anchor.set(0.5);
                bunny.tint = 0xff0000;
                bunny.x = i;
                bunny.y = 110;
                i += 10;
                return bunny;
            });

            app.stage.addChild(...bunnies2);
        }

        console.log(app.stage);
        clickNumber++;
    });
})();
