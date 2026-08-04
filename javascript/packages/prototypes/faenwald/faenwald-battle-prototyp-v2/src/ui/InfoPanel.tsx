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

// A number the panel expects to change, shown as what it stands at now and what
// it would stand at afterwards. The number it would become is the one picked
// out: the current one is already on the panel every other moment, and the
// reading being offered is the one that is not.
function Projection({ from, to }: { from: number; to: number }) {
  return (
    <>
      {from}
      <span className={styles.arrow}>→</span>
      <span className={styles.projected}>{to}</span>
    </>
  );
}

const InfoPanel = { Root, Title, Row, Projection };

export { InfoPanel };
export type { InfoPanelCorner };
