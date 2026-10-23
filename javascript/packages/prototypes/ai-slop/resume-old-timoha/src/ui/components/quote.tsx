import type { FC } from "react";
import { TIMOHA } from "../../domain/candidates";

const Quote: FC = () => (
  <section className="section quote" data-reveal>
    <p className="tag">// 05 — ЖИЗНЕННАЯ ПОЗИЦИЯ</p>
    <blockquote className="quote__text glitch" data-text={`«${TIMOHA.quote}»`}>
      «{TIMOHA.quote}»
    </blockquote>
    <p className="quote__author">— Тимоха, о высшем образовании</p>
  </section>
);

export { Quote };
