import { useSignals } from "@preact/signals-react/runtime";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import courtBg from "./assets/court-bg.jpg";
import { isSetWon, match, pointLabel } from "./match";
import type { MatchState, Side } from "./match";
import styles from "./widget.module.css";

const SIDES: Side[] = [0, 1];

function BallBadge({ size }: { size: number }) {
  const id = useId();
  const r = 30;
  return (
    <svg className={styles.ball} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-fill`} cx="35%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#fff38a" />
          <stop offset="45%" stopColor="#ffd60a" />
          <stop offset="100%" stopColor="#c98f00" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="32" cy="32" r={r} />
        </clipPath>
      </defs>
      <circle cx="32" cy="32" r={r} fill={`url(#${id}-fill)`} />
      {/* Seams run edge to edge and get clipped by the ball, like a real tennis ball. */}
      <g clipPath={`url(#${id}-clip)`} fill="none" stroke="#151a24" strokeWidth="4.2" strokeLinecap="round">
        <path d="M2 14C20 22 24 42 14 62" />
        <path d="M62 50C44 42 40 22 50 2" />
      </g>
    </svg>
  );
}

// Doubles names wrap only between partners, never inside a player's name.
function TeamName({ name, tag, tagClassName }: { name: string; tag: string; tagClassName?: string }) {
  const players = name.split(" / ");
  return (
    <>
      {players.map((player, index) => (
        <Fragment key={player}>
          {index > 0 ? " " : null}
          <span className={styles.player}>
            {player}
            {index < players.length - 1 ? <span className={styles.slash}> /</span> : null}
            {index === players.length - 1 ? <span className={tagClassName}> ({tag})</span> : null}
          </span>
        </Fragment>
      ))}
    </>
  );
}

// Re-mounts its child whenever `value` changes so the CSS pop animation replays.
function Flip({ value, className }: { value: string; className: string }) {
  return (
    <span key={value} className={className}>
      {value}
    </span>
  );
}

function useMatchClock(): string {
  const [seconds, setSeconds] = useState(2 * 3600 + 47 * 60 + 12);
  useEffect(() => {
    const id = window.setInterval(() => {
      setSeconds((value) => value + 1);
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, []);
  const h = Math.floor(seconds / 3600);
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function MatchClock() {
  const clock = useMatchClock();
  return (
    <span className={styles.clock} aria-label="Match time">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4.75V8l2.25 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {clock}
    </span>
  );
}

function LiveBadge({ ended }: { ended: boolean }) {
  return (
    <span className={styles.live} data-ended={ended}>
      <i className={styles.liveDot} />
      {ended ? "Ended" : "Live"}
    </span>
  );
}

function TopBar() {
  return (
    <header className={styles.topBar}>
      <nav className={styles.event} aria-label="Breadcrumbs">
        Sport<i className={styles.eventSep}>/</i>Tennis<i className={styles.eventSep}>/</i>ATP. Beijing
      </nav>
    </header>
  );
}

function setCellTone(state: MatchState, setIndex: number, side: Side): string {
  const score = state.sets[setIndex];
  const isCurrent = setIndex === state.sets.length - 1 && state.winner === null;
  if (!score || isCurrent) {
    return "current";
  }
  return isSetWon(score, side) ? "won" : "lost";
}

function Board({ state }: { state: MatchState }) {
  const live = state.winner === null;
  const currentIndex = live ? state.sets.length - 1 : -1;
  const gridStyle = { "--sets": state.sets.length } as CSSProperties;

  // A new key on the row that won the point re-mounts it, which replays the flash in both cards.
  function rowKey(side: Side): string {
    return `${side}-${state.lastPointBy === side ? state.rally : 0}`;
  }

  return (
    <div className={styles.board} style={gridStyle}>
      <div className={styles.headerCard}>
        <LiveBadge ended={!live} />
        <MatchClock />
      </div>

      <div className={styles.playersCard} role="table" aria-label="Players">
        <div className={styles.cardHead} role="row">
          <span role="columnheader">Players</span>
        </div>
        {SIDES.map((side) => {
          const team = state.teams[side];
          return (
            <div
              key={rowKey(side)}
              className={styles.playerRow}
              data-scored={state.lastPointBy === side}
              data-won={state.winner === side}
              data-serving={live && state.server === side}
              aria-label={live && state.server === side ? `${team.name}, serving` : undefined}
              role="row"
            >
              <span className={styles.rowName} role="cell">
                <BallBadge size={28} />
                <span className={styles.rowNameText} title={team.name}>
                  <TeamName name={team.name} tag={team.tag} tagClassName={styles.rowTag} />
                </span>
              </span>
            </div>
          );
        })}
      </div>

      <div className={styles.setsCard} role="table" aria-label="Score">
        <div className={styles.setsHead} role="row">
          {state.sets.map((_, index) => (
            <span key={index} className={styles.headSet} data-current={index === currentIndex} role="columnheader">
              <span className={styles.headSetWord}>Set </span>
              {index + 1}
            </span>
          ))}
        </div>
        {SIDES.map((side) => (
          <div key={rowKey(side)} className={styles.setsRow} data-scored={state.lastPointBy === side} role="row">
            {state.sets.map((score, index) => (
              <span key={index} className={styles.setCell} data-tone={setCellTone(state, index, side)} role="cell">
                <Flip value={String(score[side])} className={styles.setValue} />
              </span>
            ))}
          </div>
        ))}
      </div>

      <div className={styles.gameCard} role="table" aria-label="Game">
        <div className={styles.cardHead} role="row">
          <span role="columnheader">{state.tiebreak ? "TB" : "Game"}</span>
        </div>
        {SIDES.map((side) => (
          <div key={rowKey(side)} className={styles.gameRow} data-scored={state.lastPointBy === side} role="row">
            <span className={styles.rowGame} role="cell">
              {live ? <Flip value={pointLabel(state, side)} className={styles.rowPoints} /> : <span className={styles.rowPoints}>–</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TennisWidget() {
  useSignals();
  const state = match.value;
  const rootRef = useRef<HTMLElement>(null);

  // A gentle parallax on the court photo makes the card feel alive under the cursor.
  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const rect = root.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    root.style.setProperty("--px", x.toFixed(3));
    root.style.setProperty("--py", y.toFixed(3));
  }

  function handlePointerLeave() {
    rootRef.current?.style.setProperty("--px", "0");
    rootRef.current?.style.setProperty("--py", "0");
  }

  return (
    <section className={styles.frame} aria-label="Live tennis score">
      <article ref={rootRef} className={styles.widget} onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave}>
        <div className={styles.bg} style={{ backgroundImage: `url(${courtBg})` }} />
        <div className={styles.glare} />
        <div className={styles.shade} />

        <TopBar />
        <Board state={state} />
      </article>
    </section>
  );
}

export { TennisWidget };
