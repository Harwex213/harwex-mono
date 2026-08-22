import type { Cost } from "../game/types";

const ICONS = {
  gold: "🪙",
  wood: "🪵",
  crystal: "💎",
};

function costText(cost: Cost): string {
  const parts: string[] = [];
  if (cost.gold) {
    parts.push(`${ICONS.gold} ${cost.gold}`);
  }
  if (cost.wood) {
    parts.push(`${ICONS.wood} ${cost.wood}`);
  }
  if (cost.crystal) {
    parts.push(`${ICONS.crystal} ${cost.crystal}`);
  }
  return parts.length > 0 ? parts.join("  ") : "бесплатно";
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

export { clock, costText, ICONS };
