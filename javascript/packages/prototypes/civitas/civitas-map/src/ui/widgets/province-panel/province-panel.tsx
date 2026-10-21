import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState } from "react";
import type { TAppRegistry } from "../../../actions/index";
import {
  fromHex,
  type ProvinceKind,
} from "../../../domain/index";
import { useStore } from "../../../store/index";
import styles from "./province-panel.module.css";

type TProvincePanelProps = {
  registry: Pick<
    TAppRegistry,
    "addProvince" | "deleteProvince" | "recolorProvince" | "renameProvince" | "selectProvince" | "setProvinceKind"
  >;
};

const KINDS: ProvinceKind[] = ["land", "sea", "lake"];

// Border detection produces provinces in the thousands, and a row carries a colour
// input, a text field and a select. Rendering them all is tens of thousands of DOM
// nodes, so only the visible slice is mounted. Rows are a fixed height, which is
// what makes the arithmetic possible.
const ROW_HEIGHT = 62;
const ROW_GAP = 4;
const OVERSCAN = 5;

function ProvincePanel({ registry }: TProvincePanelProps) {
  useSignals();

  const store = useStore();

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(480);

  const list = store.provinces.list.value;
  const activeId = store.provinces.activeId.value;
  const disabled = store.map.info.value === null;

  useEffect(() => {
    const scroller = scrollerRef.current;

    if (!scroller) {
      return;
    }

    const observer = new ResizeObserver(() => {
      setViewHeight(scroller.clientHeight);
    });

    observer.observe(scroller);

    return () => {
      observer.disconnect();
    };
  }, []);

  // The picker tool selects a province by clicking the map, and with a windowed
  // list that row is usually not mounted. Only the active id is watched: doing
  // this when the list itself changes would fight the user's scrolling.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const index = list.findIndex((province) => province.id === activeId);

    if (!scroller || index < 0) {
      return;
    }

    const top = index * (ROW_HEIGHT + ROW_GAP);

    if (top < scroller.scrollTop || top + ROW_HEIGHT > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = Math.max(0, top - scroller.clientHeight / 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const stride = ROW_HEIGHT + ROW_GAP;
  const first = Math.max(0, Math.floor(scrollTop / stride) - OVERSCAN);
  const last = Math.min(list.length, Math.ceil((scrollTop + viewHeight) / stride) + OVERSCAN);
  const visible = list.slice(first, last);

  return (
    <aside className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.heading}>
          Provinces<span className={styles.count}>{list.length}</span>
        </h2>
        <button
          disabled={disabled}
          onClick={() => {
            registry.addProvince();
          }}
          type="button"
        >
          + New
        </button>
      </header>

      <div
        className={styles.scroller}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
        }}
        ref={scrollerRef}
      >
        <ul className={styles.list} style={{ height: `${list.length * stride}px` }}>
          {visible.map((province, offset) => {
            const active = province.id === activeId;

            return (
              <li
                className={active ? `${styles.item} ${styles.itemActive}` : styles.item}
                key={province.id}
                onClick={() => {
                  registry.selectProvince(province.id);
                }}
                style={{ top: `${(first + offset) * stride}px` }}
              >
                <div className={styles.top}>
                  {/* A native colour input, so a province can be pinned to an exact
                      value when the palette has to match an existing map. */}
                  <input
                    className={styles.swatch}
                    onChange={(event) => {
                      const rgb = fromHex(event.target.value);

                      if (rgb) {
                        registry.recolorProvince(province.id, rgb);
                      }
                    }}
                    type="color"
                    value={province.hex}
                  />
                  <input
                    onChange={(event) => {
                      registry.renameProvince(province.id, event.target.value);
                    }}
                    type="text"
                    value={province.name}
                  />
                </div>
                <div className={styles.bottom}>
                  <span className={styles.hex}>{province.hex}</span>
                  <select
                    onChange={(event) => {
                      registry.setProvinceKind(province.id, event.target.value as ProvinceKind);
                    }}
                    value={province.kind}
                  >
                    {KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                  <button
                    className={styles.remove}
                    onClick={(event) => {
                      event.stopPropagation();

                      if (window.confirm(`Delete ${province.name} and erase its pixels?`)) {
                        registry.deleteProvince(province.id);
                      }
                    }}
                    title="Delete the province and erase its pixels"
                    type="button"
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {list.length === 0 && !disabled && (
        <p className={styles.empty}>No provinces yet. Add one to start painting.</p>
      )}
    </aside>
  );
}

export { ProvincePanel };
