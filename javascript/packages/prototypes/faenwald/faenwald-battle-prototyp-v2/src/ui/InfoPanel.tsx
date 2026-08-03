import type { ReactNode } from "react";
import styles from "./info-panel.module.css";

// Which corner of the nearest positioned ancestor the panel pins itself to.
// That ancestor is the caller's job: without `position: relative` on the box
// around the canvas, the panel escapes to the page.
type InfoPanelCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

type RootProps = {
  children: ReactNode;
  corner?: InfoPanelCorner;
};

// A read-only overlay for a canvas corner. Presentation only: it holds no state
// and knows nothing about hexes, so any canvas page can put one in a corner and
// feed it whatever rows it needs.
function Root({ children, corner = "bottomRight" }: RootProps) {
  return <div className={`${styles.panel} ${styles[corner]}`}>{children}</div>;
}

// The headline row — one short line, such as a name or a type.
function Title({ children }: { children: ReactNode }) {
  return <div className={styles.title}>{children}</div>;
}

// A detail row. Lays its children out in a line, so a caller passing one span
// per stat gets them evenly spaced without any styling of its own.
function Row({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}

const InfoPanel = { Root, Title, Row };

export { InfoPanel };
export type { InfoPanelCorner };
