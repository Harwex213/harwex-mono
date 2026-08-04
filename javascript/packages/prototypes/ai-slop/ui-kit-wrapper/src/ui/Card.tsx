import type { ReactNode } from "react";
import styles from "./card.module.css";

/**
 * A facade component with no kit behind it.
 *
 * Not every part of the contract needs delegating. Layout, spacing, and page
 * furniture are cheap to own and expensive to abstract: a `Card` written twice
 * in two adapters is two files that will drift. Delegate the things with
 * behaviour — focus management, popups, validation wiring — and keep the boxes.
 *
 * It reads `--app-*` tokens only, so it re-themes with the palette and looks
 * consistent under either kit.
 */
type CardProps = {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
};

function Card({ title, description, children, footer }: CardProps) {
  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        {description ? <p className={styles.description}>{description}</p> : null}
      </header>
      <div className={styles.body}>{children}</div>
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
    </section>
  );
}

export { Card };
export type { CardProps };
