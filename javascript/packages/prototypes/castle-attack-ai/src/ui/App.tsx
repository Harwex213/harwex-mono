import { FC, memo, useEffect, useRef } from "react";
import { Application } from "pixi.js";
import { Viewport } from "pixi-viewport";
import { GameStore } from "../stores/GameStore";
import { GameRenderer } from "../renderer/GameRenderer";

const App: FC = memo(() => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameStoreRef = useRef<GameStore | null>(null);
  const rendererRef = useRef<GameRenderer | null>(null);

  useEffect(() => {
    (async () => {
      if (!canvasRef.current) return;
  
       // Initialize PixiJS application
       const app = new Application();
       await app.init({
         canvas: canvasRef.current,
         width: window.innerWidth,
         height: window.innerHeight,
         backgroundColor: 0x2c3e50,
         resolution: window.devicePixelRatio || 1,
         autoDensity: true,
       });
  
      // Create viewport for camera control
      const viewport = new Viewport({
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
        worldWidth: 2000,
        worldHeight: 1000,
        events: app.renderer.events,
      });
  
      app.stage.addChild(viewport);
  
      // Initialize game store and renderer
      const gameStore = new GameStore();
      const gameRenderer = new GameRenderer(app, viewport, gameStore);
      
      // Connect renderer to game store
      gameStore.setRenderer(gameRenderer);
      
      gameStoreRef.current = gameStore;
      rendererRef.current = gameRenderer;
  
      // Start game loop
      gameStore.startGame();
  
      // Handle window resize
      const handleResize = () => {
        app.renderer.resize(window.innerWidth, window.innerHeight);
        viewport.resize(window.innerWidth, window.innerHeight);
      };
  
      window.addEventListener('resize', handleResize);
  
      return () => {
        window.removeEventListener('resize', handleResize);
        gameStore.stopGame();
        app.destroy(true);
      };
    })();
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', margin: 0, padding: 0 }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
});

export { App };
