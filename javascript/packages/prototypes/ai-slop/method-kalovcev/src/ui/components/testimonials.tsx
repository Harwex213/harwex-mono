import type { FC } from "react";
import { TESTIMONIALS } from "../../domain/pillars";

const Testimonials: FC = () => {
  return (
    <section className="testimonials">
      <p className="eyebrow" data-reveal>Адепты</p>
      <div className="testimonials__grid">
        {TESTIMONIALS.map((item) => (
          <figure key={item.author} className="quote" data-reveal>
            <blockquote>«{item.quote}»</blockquote>
            <figcaption>
              <strong>{item.author}</strong>
              <span>{item.role}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
};

export { Testimonials };
