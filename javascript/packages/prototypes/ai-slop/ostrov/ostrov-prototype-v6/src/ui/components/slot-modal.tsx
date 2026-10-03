import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import { getMeterZone, getSlotEvent, OUTCOME_LABELS, SLOT_SYMBOLS } from "../../core/toxic-slot";
import { useStore } from "../../store/store";
import { Icon } from "./icon";
import { useFocusTrap } from "./use-focus-trap";
import type { FC, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { TSlotSpin, TSlotSymbolId } from "../../core/toxic-slot";
import type { TCloseSlotModalAction } from "../../domain/registry";

type TSlotModalRegistrySlice = {
  closeSlotModalAction: TCloseSlotModalAction;
};

type TSlotModalProps = {
  registry: TSlotModalRegistrySlice;
};

const TITLE_ID = "slot-modal-title";
/** The symbols a spinning reel scrolls through, top to bottom. */
const STRIP: readonly TSlotSymbolId[] = ["gear", "skull", "coin", "poison"];

type TReelProps = {
  index: number;
  symbol: TSlotSymbolId;
  isSpinning: boolean;
  isForced: boolean;
};

/** One reel. It scrolls while it spins and lands on its symbol when it stops. */
const Reel: FC<TReelProps> = ({ index, symbol, isSpinning, isForced }) => {
  if (isSpinning) {
    return (
      <div className="slot-reel slot-reel--spinning" aria-label={`Барабан ${index + 1}: крутится`}>
        <div className="slot-reel__strip" style={{ animationDelay: `${index * -90}ms` }}>
          {[...STRIP, ...STRIP].map((id, position) => (
            <Icon key={`${id}-${position}`} src={SLOT_SYMBOLS[id].icon} className="slot-reel__icon" />
          ))}
        </div>
      </div>
    );
  }

  const meta = SLOT_SYMBOLS[symbol];
  const label = isForced ? `${meta.label}: шкала полна, череп выпал принудительно` : meta.label;

  return (
    <div className={`slot-reel slot-reel--landed ${meta.isBad ? "slot-reel--bad" : "slot-reel--good"}`}>
      <Icon src={meta.icon} label={label} className="slot-reel__icon" />

      {isForced ? <span className="slot-reel__forced" aria-hidden="true" /> : null}
    </div>
  );
};

type TSlotDialogProps = {
  registry: TSlotModalRegistrySlice;
  spin: TSlotSpin;
  stopped: number;
  isDone: boolean;
};

/**
 * The slot when the tax phase ends: the reels start at once and stop left to
 * right, then the event shows with what it really did. The button takes the
 * player to the world map; it answers only once the event shows.
 */
const SlotDialog: FC<TSlotDialogProps> = ({ registry, spin, stopped, isDone }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const onTrapKeyDown = useFocusTrap(dialogRef);
  const zone = getMeterZone(spin.level);
  const event = getSlotEvent(spin.eventId);
  const tone = spin.outcome === "luck" || spin.outcome === "fortune" ? "good" : "bad";

  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  const onKeyDown = (keyEvent: ReactKeyboardEvent) => {
    if (keyEvent.key === "Escape") {
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      registry.closeSlotModalAction();

      return;
    }

    onTrapKeyDown(keyEvent);
  };

  return (
    <div className="modal-backdrop slot-modal-backdrop">
      <div
        ref={dialogRef}
        className={`panel modal slot-modal slot-modal--level-${spin.level}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        onKeyDown={onKeyDown}
      >
        <div className="slot-modal__head">
          <h2 className="modal__title slot-modal__title" id={TITLE_ID}>
            {"Слот токсичности"}
          </h2>

          <span className="slot-modal__level">
            {zone.status}
          </span>
        </div>

        <div className="slot-modal__reels">
          {spin.reels.map((symbol, index) => (
            <Reel
              key={index}
              index={index}
              symbol={symbol}
              isSpinning={!isDone && index >= stopped}
              isForced={spin.forcedReel === index}
            />
          ))}
        </div>

        <div className="slot-modal__display" aria-live="polite">
          {isDone ? (
            <div className={`slot-modal__event slot-modal__event--${tone}`}>
              <div className="slot-modal__event-head">
                <Icon src={event.icon} className="slot-modal__event-icon" />

                <div className="slot-modal__event-heading">
                  <span className={`slot-modal__outcome slot-modal__outcome--${tone}`}>
                    {OUTCOME_LABELS[spin.outcome]}
                  </span>

                  <span className="slot-modal__event-title">
                    {event.title}
                  </span>
                </div>
              </div>

              <p className="slot-modal__event-text">
                {event.text}
              </p>

              <ul className="slot-modal__lines">
                {spin.lines.map((line, index) => (
                  <li key={`${line.text}-${index}`} className={`slot-modal__line slot-modal__line--${line.tone}`}>
                    <Icon src={line.icon} />
                    {line.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="slot-modal__spinning">
              {"Барабаны крутятся…"}
            </p>
          )}
        </div>

        <div className="modal__buttons slot-modal__buttons">
          <button
            ref={buttonRef}
            type="button"
            className="button button--primary"
            aria-disabled={!isDone}
            onClick={registry.closeSlotModalAction}
          >
            {"Перейти к фазе разведки"}
          </button>
        </div>
      </div>
    </div>
  );
};

/** Shown from the end of the tax phase until the player leaves for the world map. */
const SlotModal: FC<TSlotModalProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const slot = store.game.slot.value;

  if (slot.status === "closed" || !slot.spin) {
    return null;
  }

  return <SlotDialog registry={registry} spin={slot.spin} stopped={slot.stopped} isDone={slot.status === "done"} />;
};

export { SlotModal };
