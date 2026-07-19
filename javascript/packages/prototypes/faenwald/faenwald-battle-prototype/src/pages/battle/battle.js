import { BATTLE_PHASE } from "../../modules/active-battle.js";
import { ROUTES } from "../../data/routing.js";
import { topNavHtml } from "../../components/top-nav.js";
import { MODEL } from "../../model/model.js";
import { initializeAbstractCanvas } from "../../modules/abstract-canvas.js";

const STYLE = `
  <style>
    .battle {
      font-family: var(--font-body);
      color: var(--text-primary);
      padding: var(--space-8);
    }

    .bd h1 {
      margin: 0 0 var(--space-7);
      font-family: var(--font-display);
      font-size: var(--font-size-xl);
      color: var(--text-accent);
      text-align: center;
    }

    .bd .workspace {
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr) 260px;
      gap: var(--space-8);
      height: 70vh;
    }

    .bd .canvas-panel {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--card-bg);
      border: 1px dashed var(--border-medium);
      border-radius: var(--card-radius);
    }

    .bd .canvas-panel canvas {
      cursor: pointer;
      touch-action: none;
    }

    .bd .panel {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--card-radius);
      padding: var(--space-6);
      overflow-y: auto;
    }

    .bd .panel-title {
      font-family: var(--font-display);
      color: var(--text-accent);
      padding: var(--space-2) var(--space-4) 0;
    }

    .bd .panel-progress {
      color: var(--text-muted);
      padding: 0 var(--space-4) var(--space-4);
    }

    .bd .unit-card {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      font: inherit;
      text-align: center;
      color: var(--text-secondary);
      background: var(--bg-control-subtle);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-sm);
      padding: var(--space-4) var(--space-5);
      cursor: pointer;
    }

    .bd .unit-card:hover {
      color: var(--text-primary);
      background: var(--bg-control-subtle-hover);
    }

    .bd .unit-card--selected {
      color: var(--text-primary);
      background: var(--bg-accent);
      border-color: var(--border-accent-muted);
    }

    .bd .all-placed {
      margin: 0;
      padding: 0 var(--space-4);
      color: var(--text-muted);
    }

    .bd .footer {
      display: flex;
      justify-content: center;
      margin-top: var(--space-8);
    }

    .bd .footer button {
      font: inherit;
      color: var(--text-primary);
      background: var(--bg-control);
      border: 1px solid var(--border-medium);
      border-radius: var(--radius-sm);
      padding: var(--space-5) var(--space-8);
      cursor: pointer;
    }

    .bd .footer button:hover {
      background: var(--bg-control-hover);
    }

    .bd .footer button:disabled {
      color: var(--text-muted);
      border-color: var(--border-default);
      background: transparent;
      cursor: default;
    }

    .bd .missing {
      color: var(--text-muted);
    }

    .bd a {
      color: var(--text-secondary);
    }

    .bd a:hover {
      color: var(--text-primary);
    }
  </style>
`;

const BATTLE_PHASE_ROUTES = {
  [BATTLE_PHASE.DISPOSITION]: ROUTES.BATTLE_DISPOSITION,
  [BATTLE_PHASE.ACTIVE]: ROUTES.BATTLE_ACTIVE,
  [BATTLE_PHASE.FINISHED]: ROUTES.BATTLE_FINISHED,
};

const renderBattle = ({ root, router }) => {
  if (MODEL.activeBattle.phase === null) {
    router.replace(ROUTES.BATTLE_CREATION);
    return () => void 0;
  }

  const LEFT_PANEL_ID = "bd-attacker-panel";
  const RIGHT_PANEL_ID = "bd-defender-panel";
  const CANVAS_PANEL_ID = "bd-canvas-panel";
  const FOOTER_ID = "bd-footer";

  root.innerHTML = `
    ${topNavHtml(router)}
    ${STYLE}
    <section class="bd">
      <h1>Размещение армий</h1>
      <div class="workspace">
        <aside id="${LEFT_PANEL_ID}" class="panel"></aside>
        <div id="${CANVAS_PANEL_ID}" class="canvas-panel"></div>
        <aside id="${RIGHT_PANEL_ID}" class="panel"></aside>
      </div>
      <div id="${FOOTER_ID}" class="footer"></div>
    </section>
  `;

  const canvasPanel = document.getElementById(CANVAS_PANEL_ID);

  const { destroy } = initializeAbstractCanvas(canvasPanel, {
    worldBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    render: ({ ctx }) => {
      ctx.beginPath();
      ctx.rect(0, 0, 100, 100);
      ctx.stroke();
    },
  });

  return () => {
    root.innerHTML = "";
    destroy();
  };
};

export { renderBattle };
