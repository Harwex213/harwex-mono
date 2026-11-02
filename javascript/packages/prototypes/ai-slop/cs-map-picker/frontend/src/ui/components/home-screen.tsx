import type { FC } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import type { TAppRegistry } from "../../domain/registry";
import { useStore } from "../../store/store";
import { FORMAT_LABEL, statusText } from "../labels";

type THomeScreenProps = {
  registry: TAppRegistry;
};

const HomeScreen: FC<THomeScreenProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const stored = store.storedPicks.value;
  const views = new Map(store.myPickViews.value.map((view) => [view.id, view]));
  const maps = new Map((store.meta.value?.maps ?? []).map((map) => [map.id, map.name]));

  return (
    <div className="home">
      <section className="hero">
        <h1>Выбор карт для CS2</h1>
        <p className="muted">Монетка решает, кто банит первым. Дальше команды по очереди вычёркивают карты, пока не останется одна.</p>
        <div className="hero-actions">
          <button className="button button-primary button-big" onClick={() => registry.navigate({ name: "new" })}>
            Начать пикать
          </button>
          <button className="button button-big" onClick={() => registry.navigate({ name: "join" })}>
            Присоединиться к пикам
          </button>
        </div>
      </section>

      <section className="my-picks">
        <h2>Мои пики</h2>
        {stored.length === 0 && <p className="muted">Здесь появятся пики, которые ты начал или к которым присоединился.</p>}
        <ul className="pick-list">
          {stored.map((entry) => {
            const view = views.get(entry.id);
            return (
              <li key={entry.id} className="pick-row">
                <a className="pick-row-link" href={`#/p/${entry.id}`}>
                  <span className="pick-row-title">
                    {view ? `${view.teamA.name} vs ${view.teamB.name}` : entry.id}
                  </span>
                  <span className="pick-row-meta">
                    <span className="chip">{entry.side === "a" ? "создал" : "присоединился"}</span>
                    {view && <span className="chip">{FORMAT_LABEL[view.format]}</span>}
                    {view && <span className={`status status-${view.phase}`}>{statusText(view)}</span>}
                    {view?.phase === "done" && (
                      <span className="muted">{view.playOrder.map((id) => maps.get(id) ?? id).join(" → ")}</span>
                    )}
                    <code className="muted">{entry.id}</code>
                  </span>
                </a>
                <button className="icon-button" title="Убрать из списка" aria-label="Убрать из списка" onClick={() => registry.forgetPick(entry.id)}>
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
};

export { HomeScreen };
