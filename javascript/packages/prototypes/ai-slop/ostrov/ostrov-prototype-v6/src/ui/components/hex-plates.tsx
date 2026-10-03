import { useSignals } from "@preact/signals-react/runtime";
import { dieAverages, dieResources, hexDie } from "../../core/dice";
import { HEX_SIZE, hexToPixel } from "../../core/hex";
import { ICONS } from "../../core/icons";
import { getResource } from "../../core/resources";
import { POWER_PER_TURN } from "../../core/stronghold";
import { facePayout, isDead, isFoodBlocked } from "../../core/tax";
import { findRoll } from "../../core/tax-plan";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { THexDie } from "../../core/dice";
import type { TPayoutEffects } from "../../core/tax";
import type { TTaxRoll } from "../../core/tax-plan";
import type { THex } from "../../core/types";

/**
 * The plate under every die on the island: what the die pays on average, and
 * how toxic the hex is. In the tax phase the first row shows the rolled face
 * instead, with what it will really pay. The plates live in the canvas's own
 * units, so they zoom with the island. Below `MIN_SCALE` the text is too small
 * to read, and the plates are hidden.
 *
 * The plate sits on the lower edge of the hex, over the scorched base of the
 * 256px sprite, so the building itself stays in view.
 */

const MIN_SCALE = 0.6;
const FONT = 9;
const ICON = 11;
/** Stacked resource icons of a mixed die overlap by this much. */
const FAN_STEP = 5;
const GAP = 2;
const GROUP_GAP = 5;
const PAD_X = 4;
/** Estimated advance of one glyph of the plate font, in canvas units. */
const CHAR_WIDTH = FONT * 0.6;
const ROW_TOP = HEX_SIZE * 0.4;
const ROW_HEIGHT = 13;
const METER_HEIGHT = 10;
const METER_WIDTH = 28;
const METER_BAR = 3.5;

type TPlateItem =
  | { readonly kind: "icon"; readonly href: string; readonly label: string }
  | { readonly kind: "fan"; readonly hrefs: readonly string[] }
  | { readonly kind: "text"; readonly text: string; readonly tone: "yield" | "toxic" | "power" | "dim" }
  | { readonly kind: "gap" };

const itemWidth = (item: TPlateItem) => {
  if (item.kind === "icon") {
    return ICON;
  }

  if (item.kind === "fan") {
    return ICON + FAN_STEP * (item.hrefs.length - 1);
  }

  if (item.kind === "gap") {
    return GROUP_GAP - GAP;
  }

  return item.text.length * CHAR_WIDTH;
};

const rowWidth = (items: readonly TPlateItem[]) => {
  return items.reduce((sum, item) => sum + itemWidth(item), 0) + GAP * Math.max(0, items.length - 1);
};

const formatAverage = (value: number) => value.toFixed(1);

/** The first row outside the tax phase: the die's averages. */
const averageItems = (die: THexDie, hex: THex): TPlateItem[] => {
  const averages = dieAverages(die);
  const resources = dieResources(die);
  const yieldIcon: TPlateItem =
    resources.length === 1 && resources[0]
      ? { kind: "icon", href: getResource(resources[0]).icon, label: getResource(resources[0]).label }
      : { kind: "fan", hrefs: resources.map((resource) => getResource(resource).icon) };
  const idle = isDead(hex) || (resources.every((resource) => resource === "food") && isFoodBlocked(hex));
  const items: TPlateItem[] = [yieldIcon, { kind: "text", text: formatAverage(averages.amount), tone: idle ? "dim" : "yield" }];

  if (die.source === "stronghold") {
    items.push({ kind: "gap" }, { kind: "icon", href: ICONS.power, label: "Власть" });
    items.push({ kind: "text", text: `+${POWER_PER_TURN}`, tone: "power" });

    return items;
  }

  items.push({ kind: "gap" }, { kind: "icon", href: ICONS.toxicity, label: "Токсичность" });
  items.push({ kind: "text", text: formatAverage(averages.toxicity), tone: "toxic" });

  return items;
};

/** The first row in the tax phase: the face the die will pay, after toxicity. */
const rollItems = (die: THexDie, hex: THex, roll: TTaxRoll, effects: TPayoutEffects): TPlateItem[] => {
  const face = roll.faces[roll.chosenIndex];
  if (!face) {
    return [];
  }

  const paid = facePayout(face, hex, effects);
  const items: TPlateItem[] = [];

  if (roll.chosenIndex !== roll.rolledIndex) {
    items.push({ kind: "icon", href: ICONS.power, label: "Выбрано за власть" });
  }

  items.push({ kind: "icon", href: getResource(face.resource).icon, label: getResource(face.resource).label });
  items.push({ kind: "text", text: `+${paid.amount}`, tone: paid.amount > 0 ? "yield" : "dim" });

  if (die.source === "stronghold") {
    items.push({ kind: "gap" }, { kind: "icon", href: ICONS.power, label: "Власть" });
    items.push({ kind: "text", text: `+${POWER_PER_TURN}`, tone: "power" });

    return items;
  }

  items.push({ kind: "gap" }, { kind: "icon", href: ICONS.toxicity, label: "Токсичность" });
  items.push({ kind: "text", text: `+${paid.toxicity}%`, tone: "toxic" });

  return items;
};

type TPlateRowProps = {
  items: readonly TPlateItem[];
  centerY: number;
};

const PlateRow: FC<TPlateRowProps> = ({ items, centerY }) => {
  let x = -rowWidth(items) / 2;

  return (
    <>
      {items.map((item, index) => {
        const left = x;
        x += itemWidth(item) + GAP;

        if (item.kind === "gap") {
          return null;
        }

        if (item.kind === "icon") {
          return (
            <image
              key={index}
              href={item.href}
              x={left}
              y={centerY - ICON / 2}
              width={ICON}
              height={ICON}
            />
          );
        }

        if (item.kind === "fan") {
          return (
            <g key={index}>
              {item.hrefs.map((href, fanIndex) => (
                <image
                  key={href}
                  href={href}
                  x={left + fanIndex * FAN_STEP}
                  y={centerY - ICON / 2}
                  width={ICON}
                  height={ICON}
                />
              ))}
            </g>
          );
        }

        return (
          <text
            key={index}
            className={`hex-plate__text hex-plate__text--${item.tone}`}
            x={left}
            y={centerY}
            fontSize={FONT}
            dominantBaseline="central"
          >
            {item.text}
          </text>
        );
      })}
    </>
  );
};

type THexPlateProps = {
  hex: THex;
  die: THexDie;
  roll: TTaxRoll | null;
  effects: TPayoutEffects;
};

const HexPlate: FC<THexPlateProps> = ({ hex, die, roll, effects }) => {
  const center = hexToPixel(hex.q, hex.r, HEX_SIZE);
  const items = roll ? rollItems(die, hex, roll, effects) : averageItems(die, hex);
  const toxicity = Math.round(hex.toxicity);
  const meterText = `${toxicity}%`;
  const meterWidth = ICON * 0.8 + GAP + METER_WIDTH + GAP + meterText.length * CHAR_WIDTH;
  const width = Math.max(rowWidth(items), meterWidth) + PAD_X * 2;
  const height = ROW_HEIGHT + METER_HEIGHT + 2;
  const rowY = ROW_TOP + 1 + ROW_HEIGHT / 2;
  const meterY = ROW_TOP + 1 + ROW_HEIGHT + METER_HEIGHT / 2;
  const meterLeft = -meterWidth / 2;
  const barLeft = meterLeft + ICON * 0.8 + GAP;
  const isPicked = roll !== null && roll.chosenIndex !== roll.rolledIndex;
  const level = isDead(hex) ? "dead" : isFoodBlocked(hex) ? "high" : toxicity > 0 ? "some" : "clean";

  return (
    <g
      className={`hex-plate ${roll ? "hex-plate--roll" : ""} ${isPicked ? "hex-plate--picked" : ""}`}
      transform={`translate(${center.x} ${center.y})`}
    >
      <rect
        className="hex-plate__back"
        x={-width / 2}
        y={ROW_TOP}
        width={width}
        height={height}
        rx={4}
      />

      <PlateRow items={items} centerY={rowY} />

      <image
        href={ICONS.toxicity}
        x={meterLeft}
        y={meterY - (ICON * 0.8) / 2}
        width={ICON * 0.8}
        height={ICON * 0.8}
      />

      <rect
        className="hex-plate__meter"
        x={barLeft}
        y={meterY - METER_BAR / 2}
        width={METER_WIDTH}
        height={METER_BAR}
        rx={METER_BAR / 2}
      />

      {toxicity > 0 ? (
        <rect
          className={`hex-plate__meter-fill hex-plate__meter-fill--${level}`}
          x={barLeft}
          y={meterY - METER_BAR / 2}
          width={(METER_WIDTH * Math.min(100, toxicity)) / 100}
          height={METER_BAR}
          rx={METER_BAR / 2}
        />
      ) : null}

      <text
        className={`hex-plate__text hex-plate__text--meter hex-plate__text--${level}`}
        x={barLeft + METER_WIDTH + GAP}
        y={meterY}
        fontSize={FONT * 0.85}
        dominantBaseline="central"
      >
        {meterText}
      </text>
    </g>
  );
};

type THexPlatesProps = {
  scale: number;
};

/** Every plate of the viewed island, drawn above the hexes and their outlines. */
const HexPlates: FC<THexPlatesProps> = ({ scale }) => {
  useSignals();
  const store = useStore();
  const player = store.derived.viewedPlayer.value;
  const isReadonly = store.derived.isReadonly.value;
  const taxPlan = store.derived.humanTaxPlan.value;
  const effects = store.derived.techEffects.value;
  const stage = store.game.stage.value;

  if (!player || scale < MIN_SCALE || stage === "setup" || stage === "starting") {
    return null;
  }

  return (
    <g className="hex-plates">
      {player.island.hexes.map((hex) => {
        const die = hexDie(player, hex);
        if (!die) {
          return null;
        }

        const roll = isReadonly ? null : findRoll(taxPlan, hex.id);

        return <HexPlate key={hex.id} hex={hex} die={die} roll={roll} effects={effects} />;
      })}
    </g>
  );
};

export { HexPlates };
