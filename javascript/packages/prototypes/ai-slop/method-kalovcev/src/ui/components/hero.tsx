import type { FC } from "react";
import heroImage from "../../assets/hero.jpg";
import { LiquidImage } from "./shader-canvas";

const Hero: FC = () => {
  return (
    <header className="hero">
      <nav className="hero__nav">
        <span className="brand">
          <span className="brand__mark">К</span>
          Метод Каловцева
        </span>
        <div className="hero__links">
          <a href="#pillars">Четыре столпа</a>
          <a href="#day">Сутки</a>
          <a href="#forbidden">Запреты</a>
          <a href="#ritual" className="pill-link">Начать откат</a>
        </div>
      </nav>

      <div className="hero__body">
        <div className="hero__copy">
          <p className="eyebrow">Авторская методика восстановления · est. 2026</p>
          <h1 className="hero__title">
            Метод
            <br />
            Каловцева
          </h1>
          <p className="hero__slogan">Откат до базовых.</p>
          <p className="hero__lead">
            Четыре действия в день — и ничего сверху. Психолог больше не нужен: вы просто перестаёте делать лишнее.
          </p>
          <div className="hero__actions">
            <a href="#ritual" className="button button--primary">Начать откат</a>
            <a href="#pillars" className="button button--ghost">Как это работает</a>
          </div>
          <dl className="hero__stats">
            <div>
              <dt>4</dt>
              <dd>действия в сутки</dd>
            </div>
            <div>
              <dt>0</dt>
              <dd>созвонов</dd>
            </div>
            <div>
              <dt>0 ₽</dt>
              <dd>на терапию</dd>
            </div>
          </dl>
        </div>

        <div className="hero__visual">
          <div className="hero__halo" />
          <LiquidImage src={heroImage} label="Мраморный бюст Каловцева в халате и маске для сна" zoom={1.08} className="hero__bust" />
          <p className="hero__caption">
            <span>Д. Каловцев</span>
            мрамор, махра, 2026
          </p>
        </div>
      </div>

      <a href="#manifesto" className="scroll-hint" aria-label="Листать вниз">
        <span />
      </a>
    </header>
  );
};

export { Hero };
