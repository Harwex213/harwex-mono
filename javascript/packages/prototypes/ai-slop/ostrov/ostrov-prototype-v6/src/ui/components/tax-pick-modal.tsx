import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState } from "react";
import { getBiome } from "../../core/biomes";
import { hexDie } from "../../core/dice";
import { ICONS } from "../../core/icons";
import { getResource } from "../../core/resources";
import { DEAD_TOXICITY_PCT, facePayout } from "../../core/tax";
import { pickCost, pickRefusal, POWER_BIOME_FACE_COST, POWER_FACE_COST } from "../../core/tax-plan";
import { useStore } from "../../store/store";
import { Icon } from "./icon";
import { useFocusTrap } from "./use-focus-trap";
import type { FC, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { TPayoutEffects } from "../../core/tax";
import type { TTaxPlan, TTaxRoll } from "../../core/tax-plan";
import type { THex, TPlayer } from "../../core/types";
import type { TCloseTaxPickAction, TPickTaxFaceAction } from "../../domain/registry";

type TTaxPickModalRegistrySlice = {
  closeTaxPickAction: TCloseTaxPickAction;
  pickTaxFaceAction: TPickTaxFaceAction;
};

type TTaxPickModalProps = {
  registry: TTaxPickModalRegistrySlice;
};

type TTaxPickDialogProps = {
  registry: TTaxPickModalRegistrySlice;
  player: TPlayer;
  plan: TTaxPlan;
  hex: THex;
  roll: TTaxRoll;
  effects: TPayoutEffects;
  powerLeft: number;
};

const TITLE_ID = "tax-pick-title";
const HINT_ID = "tax-pick-hint";

/** Arrow keys walk the faces and wrap around; Home and End jump to the ends. */
const nextIndex = (key: string, current: number, count: number) => {
  if (key === "ArrowDown" || key === "ArrowRight") {
    return (current + 1) % count;
  }

  if (key === "ArrowUp" || key === "ArrowLeft") {
    return (current - 1 + count) % count;
  }

  if (key === "Home") {
    return 0;
  }

  if (key === "End") {
    return count - 1;
  }

  return null;
};

/**
 * The popup of one die in the tax phase. It lists every face of the die on
 * this biome, the biome face included, with what each face would really pay
 * here. The rolled face is marked and free; any other face costs power. A face
 * that cannot be taken stays in the list, dimmed, with the reason. The focused
 * face is previewed below the list: its payout, the hex's toxicity after it and
 * the power left. Nothing is paid here: the choice waits for the end of the
 * phase.
 */
const TaxPickDialog: FC<TTaxPickDialogProps> = ({ registry, player, plan, hex, roll, effects, powerLeft }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focused, setFocused] = useState(roll.chosenIndex);
  const onTrapKeyDown = useFocusTrap(dialogRef);
  const die = hexDie(player, hex);
  const biome = getBiome(hex.biome);

  useEffect(() => {
    optionRefs.current[roll.chosenIndex]?.focus();
  }, [roll.chosenIndex]);

  if (!die) {
    return null;
  }

  // The power already on this die comes back when another face is taken.
  const refundable = pickCost(roll, roll.chosenIndex);
  const options = roll.faces.map((face, index) => {
    const paid = facePayout(face, hex, effects);
    const refusal = pickRefusal(player, plan, hex.id, index);
    const cost = pickCost(roll, index);

    return { face, index, paid, refusal, cost, powerAfter: powerLeft + refundable - cost };
  });
  const preview = options[focused] ?? options[0];

  const pick = (index: number) => {
    const option = options[index];
    if (!option || option.refusal) {
      return;
    }

    registry.pickTaxFaceAction(hex.id, index);
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      registry.closeTaxPickAction();

      return;
    }

    const target = nextIndex(event.key, focused, options.length);
    if (target !== null) {
      event.preventDefault();
      setFocused(target);
      optionRefs.current[target]?.focus();

      return;
    }

    onTrapKeyDown(event);
  };

  return (
    <div className="modal-backdrop" onClick={registry.closeTaxPickAction}>
      <div
        ref={dialogRef}
        className="panel modal tax-pick"
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        aria-describedby={HINT_ID}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="tax-pick__head">
          <img className="tax-pick__art" src={die.art} alt="" width={64} height={64} />

          <div className="tax-pick__heading">
            <h2 className="modal__title tax-pick__title" id={TITLE_ID}>
              {die.label}
            </h2>

            <p className="tax-pick__subtitle">
              {`${biome.label} · токсичность гекса ${Math.round(hex.toxicity)}%`}
            </p>
          </div>

          <span className="tax-pick__power" title="Власть, доступная в этой фазе">
            <Icon src={ICONS.power} label="Власть" size="m" />
            {powerLeft}
          </span>
        </div>

        <p className="modal__text tax-pick__hint" id={HINT_ID}>
          {"Выберите грань, которую здание принесёт в конце фазы. Выпавшая грань бесплатна, "}
          {`другая стоит ${POWER_FACE_COST} власть`}
          {roll.biomeFaceIndex >= 0 ? `, грань биома — ${POWER_BIOME_FACE_COST}` : ""}
          {". Новый выбор возвращает власть, потраченную на прежний."}
        </p>

        <div className="tax-pick__faces" role="radiogroup" aria-labelledby={TITLE_ID}>
          {options.map((option) => {
            const isRolled = option.index === roll.rolledIndex;
            const isChosen = option.index === roll.chosenIndex;
            const isBiome = option.index === roll.biomeFaceIndex;
            const resource = getResource(option.face.resource);
            const classes = [
              "tax-pick__face",
              isRolled ? "tax-pick__face--rolled" : "",
              isChosen ? "tax-pick__face--chosen" : "",
              isBiome ? "tax-pick__face--biome" : "",
              option.refusal ? "tax-pick__face--refused" : "",
              option.index === focused ? "tax-pick__face--focused" : "",
            ].join(" ");

            return (
              <button
                key={option.index}
                ref={(node) => {
                  optionRefs.current[option.index] = node;
                }}
                type="button"
                role="radio"
                className={classes}
                aria-checked={isChosen}
                aria-disabled={option.refusal !== null}
                tabIndex={option.index === focused ? 0 : -1}
                onFocus={() => setFocused(option.index)}
                onMouseEnter={() => setFocused(option.index)}
                onClick={() => pick(option.index)}
              >
                <span className="tax-pick__face-yield">
                  <Icon src={resource.icon} label={resource.label} size="m" />
                  {option.paid.amount === option.face.amount
                    ? `+${option.face.amount}`
                    : `+${option.face.amount}→${option.paid.amount}`}
                </span>

                <span className="tax-pick__face-toxicity">
                  <Icon src={ICONS.toxicity} label="Токсичность" />
                  {`+${option.paid.toxicity}%`}
                </span>

                <span className="tax-pick__tags">
                  {isRolled ? (
                    <span className="tax-pick__tag tax-pick__tag--rolled">
                      {"Выпало"}
                    </span>
                  ) : null}

                  {isBiome ? (
                    <span className="tax-pick__tag tax-pick__tag--biome">
                      {"Грань биома"}
                    </span>
                  ) : null}

                  {isChosen && !isRolled ? (
                    <span className="tax-pick__tag tax-pick__tag--chosen">
                      {"Выбрано"}
                    </span>
                  ) : null}
                </span>

                <span className="tax-pick__cost">
                  {option.cost === 0 ? (
                    "бесплатно"
                  ) : (
                    <>
                      <Icon src={ICONS.power} label="Власть" />
                      {option.cost}
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {preview ? (
          <div
            className={`tax-pick__preview ${preview.refusal ? "tax-pick__preview--refused" : ""}`}
            aria-live="polite"
          >
            {preview.refusal ? (
              <span className="tax-pick__reason">
                {preview.refusal.message}
              </span>
            ) : (
              <>
                <span className="tax-pick__preview-row">
                  {"Итог: "}
                  <Icon src={getResource(preview.face.resource).icon} label={getResource(preview.face.resource).label} />
                  {`+${preview.paid.amount} ${getResource(preview.face.resource).label.toLowerCase()}`}
                </span>

                <span className="tax-pick__preview-row">
                  <Icon src={ICONS.toxicity} label="Токсичность" />
                  {`Токсичность гекса: ${Math.round(hex.toxicity)}% → ${Math.min(
                    DEAD_TOXICITY_PCT,
                    Math.round(hex.toxicity + preview.paid.toxicity),
                  )}%`}
                </span>

                <span className="tax-pick__preview-row">
                  <Icon src={ICONS.power} label="Власть" />
                  {`Власть: ${powerLeft} → ${preview.powerAfter}`}
                </span>
              </>
            )}
          </div>
        ) : null}

        <div className="modal__buttons">
          <button type="button" className="button button--ghost" onClick={registry.closeTaxPickAction}>
            {"Отмена"}
          </button>

          <button
            type="button"
            className="button button--primary"
            disabled={!preview || preview.refusal !== null}
            title={preview?.refusal?.message}
            onClick={() => pick(focused)}
          >
            {preview && preview.cost > 0 ? `Выбрать за ${preview.cost}` : "Выбрать"}
          </button>
        </div>
      </div>
    </div>
  );
};

/** Mounts the popup while a die is picked; a new die opens a fresh popup. */
const TaxPickModal: FC<TTaxPickModalProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const pick = store.derived.taxPick.value;
  const player = store.derived.humanPlayer.value;
  const plan = store.derived.humanTaxPlan.value;
  const effects = store.derived.techEffects.value;
  const powerLeft = store.derived.powerLeft.value;

  if (!pick || !player || !plan) {
    return null;
  }

  return (
    <TaxPickDialog
      key={pick.hex.id}
      registry={registry}
      player={player}
      plan={plan}
      hex={pick.hex}
      roll={pick.roll}
      effects={effects}
      powerLeft={powerLeft}
    />
  );
};

export { TaxPickModal };
