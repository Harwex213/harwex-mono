import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import { Vignette } from "./vignette";

/**
 * Shown once the player has pressed "Готов" and the rivals still play: the
 * start-of-game vignette and a hint with the count of ready players. It goes
 * away by itself when the phase moves on and the readiness list is emptied.
 */
const WaitingOverlay = () => {
  useSignals();
  const store = useStore();
  const isWaiting = store.derived.isHumanReady.value;
  const isLocked = store.derived.isReadyLocked.value;
  const isSkipped = store.derived.isCleanupSkipped.value;
  const readyCount = store.game.ready.value.length;
  const total = store.game.players.value.length;

  if (!isWaiting) {
    return null;
  }

  const note = isSkipped
    ? "В этой клетке нет вражеских островов: зачистка пропущена"
    : isLocked
      ? null
      : "Нажмите «Отменить», чтобы вернуться к фазе";

  return (
    <>
      <Vignette mode="starting" />

      <div className="panel waiting-hint" role="status">
        <div className="waiting-hint__title">
          {`Ожидание игроков… ${readyCount} / ${total}`}
        </div>

        {note ? (
          <div className="waiting-hint__note">
            {note}
          </div>
        ) : null}
      </div>
    </>
  );
};

export { WaitingOverlay };
