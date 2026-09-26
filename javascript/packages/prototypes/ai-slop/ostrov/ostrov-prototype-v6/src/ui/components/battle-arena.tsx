import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TBattle } from "../../core/battle-sim";
import type { TSetBattleInputAction } from "../../domain/registry";

/** WASD and the arrows both steer the island. */
const KEY_TO_INPUT: Readonly<Record<string, "up" | "down" | "left" | "right">> = {
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const UNIT_FONT_PX = 19;
const HEALTH_BAR_WIDTH = 22;

type TBattleArenaRegistrySlice = {
  setBattleInputAction: TSetBattleInputAction;
};

type TBattleArenaProps = {
  registry: TBattleArenaRegistrySlice;
};

const drawBattle = (canvas: HTMLCanvasElement, battle: TBattle) => {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const ratio = Math.min(2, window.devicePixelRatio);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio;
    canvas.height = height * ratio;
  }

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const scale = Math.min(width / battle.width, height / battle.height);
  const offsetX = (width - battle.width * scale) / 2;
  const offsetY = (height - battle.height * scale) / 2;

  context.save();
  context.translate(offsetX, offsetY);
  context.scale(scale, scale);

  context.fillStyle = "#0c131c";
  context.fillRect(0, 0, battle.width, battle.height);

  for (const island of battle.islands) {
    context.beginPath();
    context.arc(island.x, island.y, island.radius, 0, Math.PI * 2);
    context.fillStyle = island.annexed ? "#3f6b2c" : "#4a4238";
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = island.annexed ? "#b6f05a" : "#7a6a55";
    context.stroke();

    context.fillStyle = "#e8f1f2";
    context.font = "13px system-ui, sans-serif";
    context.textAlign = "center";
    // Under the island, so it does not sit on top of the garrison.
    context.fillText(island.annexed ? "присоединён" : `+${island.hexes} гекс.`, island.x, island.y + island.radius + 16);
  }

  context.beginPath();
  context.arc(battle.islandX, battle.islandY, battle.islandRadius, 0, Math.PI * 2);
  context.fillStyle = "#2f5a2a";
  context.fill();
  context.lineWidth = 4;
  context.strokeStyle = "#b6f05a";
  context.stroke();

  for (const unit of battle.units) {
    context.font = `${UNIT_FONT_PX}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.fillText(unit.emoji, unit.x, unit.y + 6);

    const share = Math.max(0, unit.hp / unit.maxHp);
    context.fillStyle = "#00000088";
    context.fillRect(unit.x - HEALTH_BAR_WIDTH / 2, unit.y - 18, HEALTH_BAR_WIDTH, 3);
    context.fillStyle = unit.side === "player" ? "#8fd14f" : "#d9534f";
    context.fillRect(unit.x - HEALTH_BAR_WIDTH / 2, unit.y - 18, HEALTH_BAR_WIDTH * share, 3);
  }

  context.restore();
};

/** The level: the player's island under WASD, everyone else on auto-battle. */
const BattleArena: FC<TBattleArenaProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const battle = store.battle.battle.value;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = KEY_TO_INPUT[event.code];
      if (direction) {
        event.preventDefault();
        registry.setBattleInputAction({ [direction]: true });
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const direction = KEY_TO_INPUT[event.code];
      if (direction) {
        registry.setBattleInputAction({ [direction]: false });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [registry]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && battle) {
      drawBattle(canvas, battle);
    }
  }, [battle]);

  return <canvas className="battle-arena" ref={canvasRef} />;
};

export { BattleArena };
