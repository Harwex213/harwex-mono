import type { FC } from "react";

const Manifesto: FC = () => {
  return (
    <section className="manifesto" id="manifesto">
      <p className="eyebrow" data-reveal>Манифест</p>
      <h2 className="manifesto__title" data-reveal>
        Вы устали не от жизни.
        <br />
        <em>Вы устали от надстроек.</em>
      </h2>
      <div className="manifesto__columns">
        <p data-reveal>
          Карьера, саморазвитие, утренние страницы, дыхание по квадрату, трекер привычек для трекера привычек. Каждая
          надстройка обещает облегчение и добавляет ещё один пункт в список.
        </p>
        <p data-reveal>
          Метод Каловцева сносит надстройки и возвращает систему к заводским настройкам. Организм уже знает, что ему
          нужно. Его просто давно никто не слушал.
        </p>
      </div>
    </section>
  );
};

export { Manifesto };
