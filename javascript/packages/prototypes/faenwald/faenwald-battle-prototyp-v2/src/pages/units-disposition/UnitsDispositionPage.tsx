import { Button, Input, Tooltip } from "@hw/faenwald-uikit";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { HexCanvas } from "../../hex/HexCanvas";
import { HexGridLayer } from "../../hex/HexGridLayer";
import {
  isPlaced,
  pickUnit,
  pickedUnitId,
  placeUnit,
  placedCount,
  placedUnits,
  ready,
  recallUnit,
  roster,
  toggleReady,
  unitIdAt,
  type RosterUnit,
} from "../../state/disposition-state";
import { grid, selectCell } from "../../state/grid-state";
import { LOCAL_PLAYER, messages, players, sendMessage } from "../../state/session-state";
import { InfoIcon, SendIcon } from "../../ui/icons";
import { UnitLayer } from "../../units/UnitLayer";
import styles from "./units-disposition-page.module.css";

const ROSTER_HINT = "Pick a unit from the list, then click a hex";

function UnitsDispositionPage() {
  useSignals();

  return (
    <div className={styles.page}>
      <RosterPanel />

      <div className={styles.canvas}>
        <HexCanvas onCellClick={onCellClick} world={grid.bounds}>
          <HexGridLayer>
            <UnitLayer units={placedUnits.value} />
          </HexGridLayer>
        </HexCanvas>
      </div>

      <div className={styles.right}>
        <PlayersPanel />
        <ChatPanel />
      </div>
    </div>
  );
}

// A hex click either drops the armed roster unit or takes back whatever stands
// on the cell.
function onCellClick(key: string): void {
  selectCell(key);

  if (pickedUnitId.value !== null) {
    placeUnit(key);
    return;
  }

  const occupant = unitIdAt(key);
  if (occupant !== null) {
    recallUnit(occupant);
  }
}

function RosterPanel() {
  useSignals();

  return (
    <aside className={styles.left}>
      <div className={styles.leftHeader}>
        <h2 className={styles.leftTitle}>Ваши войска</h2>
        <Tooltip.Root>
          <Tooltip.Trigger className={styles.infoTrigger}>
            <InfoIcon />
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner>
              <Tooltip.Popup>
                {ROSTER_HINT}
                <Tooltip.Arrow />
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>

      <div className={styles.roster}>
        {roster.map((unit) => (
          <RosterRow key={unit.id} unit={unit} />
        ))}
      </div>

      <div className={styles.readyBar}>
        <Button.Root
          className={styles.readyButton}
          disabled={placedCount.value === 0}
          onClick={toggleReady}
          variant={ready.value ? "secondary" : "primary"}
        >
          {ready.value ? "Not ready" : "Ready"}
        </Button.Root>
      </div>
    </aside>
  );
}

function RosterRow({ unit }: { unit: RosterUnit }) {
  useSignals();

  const placed = isPlaced(unit.id);
  const picked = pickedUnitId.value === unit.id;
  const className = [styles.unit, picked ? styles.unitPicked : "", placed ? styles.unitPlaced : ""]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <button className={className} onClick={() => onRosterClick(unit.id)} type="button">
      <span className={styles.unitName}>
        {unit.title}
        {placed ? <span className={styles.unitBadge}>on grid</span> : null}
      </span>
      <span className={styles.unitStats}>
        {unit.stats.health} ❤️ {unit.stats.attack} ⚔️ {unit.stats.morale} 🎺
      </span>
    </button>
  );
}

// A placed unit has nothing to arm, so its row recalls it instead.
function onRosterClick(unitId: string): void {
  if (isPlaced(unitId)) {
    recallUnit(unitId);
    return;
  }
  pickUnit(unitId);
}

function PlayersPanel() {
  useSignals();

  return (
    <section className={styles.panel}>
      <ul className={styles.players}>
        {players.map((player) => {
          const isReady = player.isLocal && ready.value;
          return (
            <li className={styles.player} key={player.id}>
              <span>{player.name}</span>
              <span className={isReady ? `${styles.playerState} ${styles.playerReady}` : styles.playerState}>
                {isReady ? "ready" : "placing"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ChatPanel() {
  useSignals();

  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const count = messages.value.length;

  // Keep the newest message in view after every send.
  useEffect(() => {
    const log = logRef.current;
    if (log === null) {
      return;
    }
    log.scrollTop = log.scrollHeight;
  }, [count]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendMessage(draft);
    setDraft("");
  }

  return (
    <section className={`${styles.panel} ${styles.chat}`}>
      <div className={styles.chatLog} ref={logRef}>
        {messages.value.map((message) => (
          <div className={styles.message} key={message.id}>
            <span
              className={
                message.author === LOCAL_PLAYER
                  ? `${styles.messageAuthor} ${styles.messageMine}`
                  : styles.messageAuthor
              }
            >
              {message.author}
            </span>
            <span className={styles.messageText}>{message.text}</span>
          </div>
        ))}
      </div>

      <form className={styles.chatForm} onSubmit={onSubmit}>
        <Input.Root
          className={styles.chatInput}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder="Message…"
          value={draft}
        />
        <Button.Root
          aria-label="Send"
          className={styles.sendButton}
          disabled={draft.trim().length === 0}
          size="sm"
          type="submit"
        >
          <SendIcon className={styles.sendIcon} />
        </Button.Root>
      </form>
    </section>
  );
}

export { UnitsDispositionPage };
