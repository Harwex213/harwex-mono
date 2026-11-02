import type { FC } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { api } from "../../domain/api";
import { copyImage, copyText } from "../../domain/clipboard";
import type { TAppRegistry } from "../../domain/registry";
import { pickLink } from "../../domain/router";
import type { TPickView, TSide } from "../../domain/types";
import { useStore } from "../../store/store";
import { FORMAT_LABEL, teamOf } from "../labels";
import { CoinToss } from "./coin-toss";
import { CopyButton } from "./copy-button";
import { MapGrid } from "./map-grid";
import { Roster } from "./roster";
import { VetoTimeline } from "./veto-timeline";

type TPickScreenProps = {
  registry: TAppRegistry;
};

const TeamColumn: FC<{ pick: TPickView; side: TSide; mySide: TSide | null }> = ({ pick, side, mySide }) => {
  const team = teamOf(pick, side);
  const isTurn = pick.next?.side === side;
  return (
    <div className={isTurn ? "team team-turn" : "team"}>
      <div className="team-name">
        {team.name}
        {mySide === side && <span className="chip chip-you">ты</span>}
      </div>
      <Roster team={team} />
    </div>
  );
};

const TurnBanner: FC<{ pick: TPickView; mySide: TSide | null }> = ({ pick, mySide }) => {
  if (!pick.next) {
    return null;
  }
  const team = teamOf(pick, pick.next.side).name;
  const verb = pick.next.kind === "ban" ? "банит" : "пикает";
  if (pick.next.side === mySide) {
    const text = pick.next.kind === "ban" ? "Твой ход: выбери карту, которую убираешь" : "Твой ход: выбери карту, на которой будете играть";
    return <div className="turn turn-mine">{text}</div>;
  }
  return <div className="turn">Ход соперника: {team} {verb}…</div>;
};

const PickScreen: FC<TPickScreenProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const pick = store.pick.view.value;
  const meta = store.meta.value;
  const session = store.session.value;

  if (store.pick.loadError.value) {
    return (
      <div className="panel">
        <div className="error">{store.pick.loadError.value}</div>
        <button className="button" onClick={() => registry.navigate({ name: "home" })}>
          На главную
        </button>
      </div>
    );
  }
  if (!pick || !meta) {
    return <div className="panel muted">Загрузка…</div>;
  }

  const mySide = session?.side ?? null;
  const maps = new Map(meta.maps.map((map) => [map.id, map]));
  const myTurn = pick.phase === "veto" && pick.next?.side === mySide;
  const selected = store.pick.selectedMap.value;
  const selectedName = selected ? maps.get(selected)?.name : null;
  const link = pickLink(pick.id);

  return (
    <div className="pick">
      <section className="panel pick-head">
        <div className="pick-meta">
          <span className="chip">{FORMAT_LABEL[pick.format]}</span>
          <code className="muted">#{pick.id}</code>
          {!mySide && <span className="chip">ты зритель</span>}
        </div>
        <div className="matchup">
          <TeamColumn pick={pick} side="a" mySide={mySide} />
          <div className="versus">vs</div>
          <TeamColumn pick={pick} side="b" mySide={mySide} />
        </div>
      </section>

      {pick.phase === "waiting" && (
        <section className="panel waiting">
          {mySide === "a" ? (
            <>
              <h2>Ждём соперника</h2>
              <p className="muted">Отправь код или ссылку игроку команды {pick.teamB.name}. Как только он подключится, монетка решит, кто банит первым.</p>
              <div className="share-code">
                <code className="big-code">{pick.id}</code>
                <CopyButton label="Копировать код" copy={() => copyText(pick.id)} />
                <CopyButton label="Копировать ссылку" copy={() => copyText(link)} primary />
              </div>
            </>
          ) : (
            <>
              <h2>{pick.teamA.name} ждёт соперника</h2>
              <p className="muted">Подключись, чтобы пикать за {pick.teamB.name}.</p>
              {store.formError.value && <div className="error">{store.formError.value}</div>}
              <button className="button button-primary button-big" disabled={store.formBusy.value} onClick={() => registry.joinPick(pick.id)}>
                Играть за {pick.teamB.name}
              </button>
            </>
          )}
        </section>
      )}

      {pick.firstSide && (
        <section className="panel progress">
          <CoinToss winner={teamOf(pick, pick.firstSide).name} animate={pick.actions.length === 0} />
          <VetoTimeline pick={pick} maps={maps} />
        </section>
      )}

      {pick.phase === "veto" && <TurnBanner pick={pick} mySide={mySide} />}

      <MapGrid pick={pick} maps={meta.maps} selectable={myTurn} selectedMap={selected} onSelect={registry.selectMap} />

      {myTurn && (
        <div className="confirm-bar">
          {store.pick.actionError.value && <span className="error">{store.pick.actionError.value}</span>}
          <span className="muted">{selectedName ? `Выбрана: ${selectedName}` : "Нажми на карту"}</span>
          <button className="button" disabled={!selected} onClick={() => registry.selectMap(null)}>
            Отмена
          </button>
          <button
            className={pick.next?.kind === "ban" ? "button button-danger" : "button button-primary"}
            disabled={!selected || store.pick.busy.value}
            onClick={() => registry.confirmMap()}
          >
            {pick.next?.kind === "ban" ? "Забанить" : "Пикнуть"}
            {selectedName ? ` ${selectedName}` : ""}
          </button>
        </div>
      )}

      {pick.phase === "done" && (
        <section className="panel result">
          <h2>{pick.format === "bo3" ? "Карты финала" : "Играем на"}: {pick.playOrder.map((id) => maps.get(id)?.name ?? id).join(" → ")}</h2>
          <img className="result-image" src={api.imageUrl(pick.id)} alt="Итог выбора карт" />
          <div className="result-actions">
            <a className="button button-primary" href={api.imageUrl(pick.id)} download={`cs2-veto-${pick.id}.png`}>
              Скачать картинку
            </a>
            <CopyButton label="Копировать картинку" copy={() => copyImage(api.imageUrl(pick.id))} />
            <CopyButton label="Ссылка на картинку" copy={() => copyText(api.imageUrl(pick.id))} />
            <CopyButton label="Ссылка на пики" copy={() => copyText(link)} />
          </div>
        </section>
      )}
    </div>
  );
};

export { PickScreen };
