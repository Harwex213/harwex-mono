import { PLAYERS_FACTION_ID, SQUAD_DEFS } from "../../../core/exports";
import { useEffect, useRef, useState } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TBattle, TBattleSide, TBattleSquad } from "../../../core/exports";
import type {
  TBattleAutoToggleAction,
  TBattleFinishAction,
  TBattleSetSlotAction,
  TBattleSkillAction,
  TBattleStepAction,
} from "../../domain/registry";

/** Pause between two auto-played rounds. */
const ROUND_DELAY = 900;

type TBattleModalRegistrySlice = {
  battleSetSlotAction: TBattleSetSlotAction;
  battleStepAction: TBattleStepAction;
  battleSkillAction: TBattleSkillAction;
  battleAutoToggleAction: TBattleAutoToggleAction;
  battleFinishAction: TBattleFinishAction;
};

type TBattleModalProps = {
  registry: TBattleModalRegistrySlice;
};

const SLOTS = [0, 1, 2, 3, 4, 5];

const SquadTile: FC<{ squad: TBattleSquad | null; picked: boolean; editable: boolean; onPick: () => void }> = ({ squad, picked, editable, onPick }) => {
  if (squad === null) {
    return <button className={`slot slot--empty ${editable ? "slot--editable" : ""}`} onClick={onPick} disabled={!editable} />;
  }

  const def = SQUAD_DEFS[squad.type];
  const dead = squad.hp <= 0;

  return (
    <button className={`slot ${dead ? "slot--dead" : ""} ${picked ? "slot--picked" : ""} ${editable ? "slot--editable" : ""}`} onClick={onPick} disabled={!editable} title={`${def.name}: атака ${def.attack}, дальность ${def.range}, скорость ${def.speed}, броня ${def.armor}`}>
      <div className="slot__name">{squad.name}</div>
      <div className="bar bar--thin">
        <div className="bar__fill bar__fill--hp" style={{ width: `${(squad.hp / squad.hpMax) * 100}%` }} />
      </div>
      <div className="slot__hp">
        {squad.hp}/{squad.hpMax}
      </div>
      <div className="slot__stats">
        ⚔{def.attack} ↔{def.range} ➶{def.speed} ◈{def.armor}
      </div>
    </button>
  );
};

const SideGrid: FC<{ side: TBattleSide; editable: boolean; picked: string | null; onPick: (squadId: string | null, slot: number) => void }> = ({ side, editable, picked, onPick }) => {
  const bySlot = new Map(side.squads.map((squad) => [squad.slot, squad]));

  return (
    <div className="side" style={{ "--side": side.color } as React.CSSProperties}>
      <div className="side__head">
        <span className="swatch" style={{ background: side.color }} />
        {side.factionName} · {side.role === "attacker" ? "атакует" : "обороняется"}
        {side.armorBonus > 0 ? <span className="chip"> укрепление +{side.armorBonus} брони</span> : null}
      </div>
      <div className="side__rows">
        <div className="side__rowlabel">Первый ряд</div>
        <div className="grid">
          {SLOTS.slice(0, 3).map((slot) => {
            const squad = bySlot.get(slot) ?? null;

            return <SquadTile key={slot} squad={squad} picked={squad !== null && squad.id === picked} editable={editable} onPick={() => onPick(squad?.id ?? null, slot)} />;
          })}
        </div>
        <div className="side__rowlabel">Второй ряд</div>
        <div className="grid">
          {SLOTS.slice(3).map((slot) => {
            const squad = bySlot.get(slot) ?? null;

            return <SquadTile key={slot} squad={squad} picked={squad !== null && squad.id === picked} editable={editable} onPick={() => onPick(squad?.id ?? null, slot)} />;
          })}
        </div>
      </div>
    </div>
  );
};

const playersSide = (battle: TBattle): TBattleSide | null => {
  if (battle.attacker.factionId === PLAYERS_FACTION_ID) {
    return battle.attacker;
  }

  if (battle.defender.factionId === PLAYERS_FACTION_ID) {
    return battle.defender;
  }

  return null;
};

/**
 * The auto-battler screen. Deploy first: pick a squad, then the slot it should
 * hold. Then the rounds play by themselves; skills queue for the next round.
 */
const BattleModal: FC<TBattleModalProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const battle = store.ui.battle.value;
  const auto = store.ui.battleAuto.value;
  const [picked, setPicked] = useState<string | null>(null);
  const logRef = useRef<HTMLUListElement>(null);

  const phase = battle?.phase ?? "deploy";
  const round = battle?.round ?? 0;
  const eventCount = battle?.events.length ?? 0;

  useEffect(() => {
    if (battle === null || phase !== "fighting" || !auto) {
      return undefined;
    }

    const timer = setTimeout(registry.battleStepAction, ROUND_DELAY);

    return () => clearTimeout(timer);
  }, [battle, phase, round, auto, registry]);

  useEffect(() => {
    const list = logRef.current;

    if (list !== null) {
      list.scrollTop = list.scrollHeight;
    }
  }, [eventCount]);

  if (battle === null) {
    return null;
  }

  const mine = playersSide(battle);
  const deploying = battle.phase === "deploy";
  const editable = deploying && mine !== null;

  const pick = (squadId: string | null, slot: number) => {
    if (!editable) {
      return;
    }

    if (picked === null) {
      setPicked(squadId);

      return;
    }

    registry.battleSetSlotAction(picked, slot);
    setPicked(null);
  };

  return (
    <div className="overlay">
      <div className="battle">
        <div className="battle__head">
          <div className="battle__title">
            Бой · раунд {battle.round}
            {battle.phase === "done" ? ` · победа: ${battle.winner === "attacker" ? battle.attacker.factionName : battle.defender.factionName}` : ""}
          </div>
          <div className="muted">
            {deploying
              ? mine === null
                ? "Расстановка сторон"
                : "Расстановка: кликните отряд, затем ячейку. Первый ряд принимает удары ближнего боя, стрелки достают любой ряд."
              : battle.phase === "fighting"
                ? "Автобой идёт. Навык сработает в начале следующего раунда."
                : "Бой окончен."}
          </div>
        </div>

        <div className="battle__sides">
          <SideGrid side={battle.attacker} editable={editable && mine === battle.attacker} picked={picked} onPick={pick} />
          <div className="battle__vs">⚔</div>
          <SideGrid side={battle.defender} editable={editable && mine === battle.defender} picked={picked} onPick={pick} />
        </div>

        <div className="battle__controls">
          {mine !== null && mine.skills.length > 0 ? (
            <div className="skills">
              <span className="muted">Навыки:</span>
              {mine.skills.map((skill) => (
                <button
                  key={skill.id}
                  className={`btn btn--small ${mine.queuedSkill === skill.id ? "btn--ready" : ""}`}
                  disabled={skill.used || battle.phase === "done"}
                  title={skill.summary}
                  onClick={() => registry.battleSkillAction(skill.id)}
                >
                  {skill.name}
                  {skill.used ? " · использован" : mine.queuedSkill === skill.id ? " · готов" : ""}
                </button>
              ))}
            </div>
          ) : (
            <div className="muted">Активных навыков нет: их дают казармы и технологии.</div>
          )}

          <div className="battle__buttons">
            {deploying ? (
              <button className="btn btn--primary" onClick={registry.battleStepAction}>
                В бой
              </button>
            ) : null}
            {battle.phase === "fighting" ? (
              <>
                <button className="btn" onClick={registry.battleAutoToggleAction}>
                  {auto ? "Пауза" : "Продолжить"}
                </button>
                <button className="btn" onClick={registry.battleStepAction} disabled={auto}>
                  Раунд →
                </button>
              </>
            ) : null}
            {battle.phase === "done" ? (
              <button className="btn btn--primary" onClick={registry.battleFinishAction}>
                Продолжить
              </button>
            ) : null}
          </div>
        </div>

        <ul className="battle__log" ref={logRef}>
          {battle.events.map((event) => (
            <li key={event.id} className={`battle__event battle__event--${event.tone}`}>
              {event.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export { BattleModal };
