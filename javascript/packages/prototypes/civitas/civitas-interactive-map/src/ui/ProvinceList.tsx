import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { OVERSCAN_ROWS, PROVINCE_ROW_HEIGHT } from "./province-list";
import { ProvinceRow } from "./ProvinceRow";
import {
  buildProvinceRows,
  filterRows,
  indexOfProvince,
  normalizeQuery,
  overrideSummary,
  scrollTopForIndex,
  windowGeometry,
  windowStart,
} from "./province-list";
import { loadPhase, provinceById } from "../state/map-store";
import { provinceDisplayName, provinceOverrides } from "../state/world-store";
import { selectProvince, selectedProvinceId } from "../state/selection-store";
import type { ImageNotice, OverrideSummary } from "./province-list";
import type { ReactNode } from "react";
import styles from "./province-list.module.css";

// The virtualised province list: a search box, a scroll viewport, a sliding
// window of rows, and the two-way selection sync.
//
// AT MOST `visible + 2 * OVERSCAN_ROWS` ROWS EXIST IN THE DOM, whatever the
// country holds. That is the whole reason this component is not a `.map()` over
// `provinceIds`: a several-hundred-row list of images and textareas is exactly
// the trap T10 exists to avoid.
//
// This component holds the ONLY signal subscription in the list. `ProvinceRow`
// takes plain props and calls actions; thirteen rows each subscribing to
// `provinceOverrides` would re-render all thirteen on every keystroke anyway,
// because the parent re-renders too.
//
// THE CALL SITE PASSES `key={country.id}`. That is what resets the query and the
// scroll position when the selection moves to another country, with no effect
// and no cleanup. `country.id` does not change when provinces are painted into
// that same country, so painting never resets the list.

type ProvinceListProps = {
  provinceIds: readonly number[];
  onImageNotice: (notice: ImageNotice | null) => void;
  // The list owns the query, so it owns `shown`. The sentence and its styling
  // stay in the panel, where the rest of the panel chrome lives.
  footer: (shown: number, summary: OverrideSummary) => ReactNode;
};

function ProvinceList(props: ProvinceListProps) {
  useSignals();

  const searchId = useId();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const syncedRef = useRef<number | null>(null);
  const [query, setQuery] = useState("");
  const [first, setFirst] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  // All three reads are in the component body, never inside a `useMemo`. On a
  // render where a memo does not re-execute the component would read nothing
  // and quietly unsubscribe.
  const overrides = provinceOverrides.value;
  const selectedId = selectedProvinceId.value;
  // `getMapAssets()` is a plain module variable and NOTIFIES NOBODY. Without
  // this read the names stay "Province N" for the whole session when the panel
  // is opened before the manifest lands.
  const phase = loadPhase.value;

  // `props.provinceIds` is stable by identity: `assignProvinces` is its only
  // writer and returns the same array for every country it did not touch, and
  // `updateCountry` deliberately does not copy it. A rename, a keystroke in the
  // country lore, or a paint stroke on another country all cost zero rebuilds.
  const rows = useMemo(() => {
    return buildProvinceRows(props.provinceIds, {
      displayNameOf: provinceDisplayName,
      overrideOf: (id) => {
        return overrides.get(id) ?? null;
      },
      isKnown: (id) => {
        return provinceById(id) !== null;
      },
    });
  }, [props.provinceIds, overrides, phase]);

  const normalized = normalizeQuery(query);
  const visible = useMemo(() => {
    return filterRows(rows, normalized);
  }, [rows, normalized]);
  const summary = useMemo(() => {
    return overrideSummary(rows);
  }, [rows]);

  useEffect(() => {
    const el = viewportRef.current;
    if (el === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      setViewportHeight(el.clientHeight);
    });
    observer.observe(el);
    setViewportHeight(el.clientHeight);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Map -> list. The guard is on the SELECTION ID in a ref, not on a render, so
  // hand-scrolling never re-scrolls and the `scrollTop` write cannot loop: the
  // `scroll` event it fires re-renders, but `syncedRef` already holds the id.
  useEffect(() => {
    const el = viewportRef.current;
    if (el === null) {
      return;
    }
    if (selectedId === null) {
      syncedRef.current = null;
      return;
    }
    if (syncedRef.current === selectedId) {
      return;
    }
    const index = indexOfProvince(visible, selectedId);
    if (index < 0) {
      // Filtered out, or not in this country. Do NOT record it as synced:
      // clearing the query re-runs this effect and the scroll happens then.
      return;
    }
    syncedRef.current = selectedId;
    const next = scrollTopForIndex(
      index,
      el.scrollTop,
      el.clientHeight,
      PROVINCE_ROW_HEIGHT,
      visible.length,
    );
    if (next === null) {
      return;
    }
    el.scrollTop = next;
  }, [selectedId, visible]);

  const geometry = windowGeometry(
    first,
    viewportHeight,
    PROVINCE_ROW_HEIGHT,
    OVERSCAN_ROWS,
    visible.length,
  );
  const windowRows = visible.slice(geometry.first, geometry.last);
  const selectedHidden =
    selectedId !== null &&
    indexOfProvince(rows, selectedId) >= 0 &&
    indexOfProvince(visible, selectedId) < 0;

  function onClear(): void {
    setQuery("");
    setFirst(0);
  }

  return (
    <div className={styles.list}>
      <div className={styles.search}>
        <div className={styles.searchRow}>
          <label className={styles.hint} htmlFor={searchId}>
            Filter
          </label>
          <input
            className={styles.searchInput}
            id={searchId}
            placeholder="name or id"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              // A narrower list may not reach the current window.
              // `windowGeometry` re-clamps anyway; this keeps the scrollbar and
              // the window in step from the first frame.
              setFirst(0);
              const el = viewportRef.current;
              if (el !== null) {
                el.scrollTop = 0;
              }
            }}
          />
          {query === "" ? null : (
            <button className={styles.clear} type="button" onClick={onClear}>
              clear
            </button>
          )}
        </div>
        {selectedHidden ? (
          <p className={styles.filtered}>the selected province is hidden by this filter</p>
        ) : null}
      </div>

      {/* The viewport is ALWAYS mounted, even with nothing to show. Unmounting
          it would drop the `ResizeObserver` set up against this element, and the
          measured height would then be stale for the rest of the session. */}
      <div
        className={styles.viewport}
        ref={viewportRef}
        onScroll={(event) => {
          setFirst(
            windowStart(
              event.currentTarget.scrollTop,
              PROVINCE_ROW_HEIGHT,
              OVERSCAN_ROWS,
              visible.length,
            ),
          );
        }}
      >
        {visible.length === 0 ? (
          <p className={styles.empty}>
            no province matches “{query.trim()}” —{" "}
            <button className={styles.clear} type="button" onClick={onClear}>
              clear filter
            </button>
          </p>
        ) : (
          <div className={styles.spacer} style={{ height: geometry.totalHeight }}>
            {/* ONE translated block of contiguous rows, not one absolute
                position per row: a scroll step is a single style write. */}
            <div
              className={styles.window}
              style={{ transform: "translateY(" + geometry.offsetY + "px)" }}
            >
              <ul className={styles.rows}>
                {windowRows.map((row) => {
                  return (
                    <ProvinceRow
                      key={row.id}
                      row={row}
                      selected={selectedId === row.id}
                      onImageNotice={props.onImageNotice}
                      onSelect={selectProvince}
                    />
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </div>

      {props.footer(visible.length, summary)}
    </div>
  );
}

export { ProvinceList, type ProvinceListProps };
