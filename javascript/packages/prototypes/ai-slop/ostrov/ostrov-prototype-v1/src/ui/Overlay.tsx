import { useSignals } from "@preact/signals-react/runtime";
import { useState } from "react";
import * as hud from "../game/hud";
import { game } from "../game/instance";
import { clock } from "./format";

function Overlay(): React.JSX.Element | null {
  useSignals();
  const [introOpen, setIntroOpen] = useState(true);
  const phase = hud.phase.value;

  if (phase === "play" && introOpen) {
    return (
      <div className="overlay">
        <div className="card-big">
          <h1>Остров</h1>
          <p className="lead">
            Плавучий остров держится против моря. Стройте, нанимайте, двигайте остров на новую землю — и решайте
            сами, когда вы готовы штурмовать Левиафана.
          </p>
          <ol className="loop">
            <li>Стройте здания из доступных сейчас: они открывают ветку развития, найм и пассивный доход.</li>
            <li>Заказывайте юнитов и ставьте точку сбора — это армия для защиты и для атаки.</li>
            <li>Двигайте остров на соседний сектор: новая земля, ресурсы и уникальные здания.</li>
            <li>Отразили волну — выжили и получили золото с убитых. Не отразили — конец.</li>
            <li>Считаете, что развились достаточно, — идите на босса. Убили его — победа.</li>
          </ol>
          <p className="muted">
            Мышь: ЛКМ — выбор и постройка, ПКМ — точка сбора, колесо — зум, перетаскивание — камера. Пробел — пауза,
            1/2/3 — скорость.
          </p>
          <button type="button" className="wide primary" onClick={() => setIntroOpen(false)}>
            Начать
          </button>
        </div>
      </div>
    );
  }

  if (phase === "play") {
    return null;
  }

  return (
    <div className="overlay">
      <div className="card-big">
        <h1>{phase === "won" ? "Победа" : "Остров пал"}</h1>
        <p className="lead">
          {phase === "won"
            ? "Левиафан повержен, море успокоилось."
            : "Ядро острова разрушено. Море забрало всё, что вы построили."}
        </p>
        <div className="rows">
          <div className="row">
            <span>Прожито</span>
            <span>{clock(hud.elapsed.value)}</span>
          </div>
          <div className="row">
            <span>Волн отбито</span>
            <span>{Math.max(0, hud.wave.value - (hud.waveRunning.value ? 1 : 0))}</span>
          </div>
          <div className="row">
            <span>Убито врагов</span>
            <span>{hud.killed.value}</span>
          </div>
          <div className="row">
            <span>Золота с убитых</span>
            <span>{hud.earnedFromKills.value}</span>
          </div>
          <div className="row">
            <span>Секторов захвачено</span>
            <span>{hud.ownedSectors.value}</span>
          </div>
        </div>
        <button
          type="button"
          className="wide primary"
          onClick={() => {
            game.restart(Math.floor(Math.random() * 1_000_000_000));
            setIntroOpen(false);
          }}
        >
          Ещё раз
        </button>
      </div>
    </div>
  );
}

export { Overlay };
