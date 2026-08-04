import { useEffect, useState } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  ensureMapLoaded,
  getMapAssets,
  loadError,
  loadPhase,
  loadProgress,
  loadStep,
  mapSize,
  provinceAt,
  provinceById,
  provinceCount,
} from "./state/map-store";
import styles from "./app.module.css";

// Pixels verified by decoding `assets/provinces_map.png` directly; see
// `.plan/T02/DESIGN.md` section 0. A wrong answer in this table means the
// decode, the packing or the lookup is broken.
const PROBE_PIXELS: { x: number; y: number; expected: number | null }[] = [
  { x: 598, y: 391, expected: 1 },
  { x: 1496, y: 395, expected: 2 },
  { x: 1382, y: 1329, expected: 1000 },
  { x: 1513, y: 2744, expected: 1650 },
  { x: 0, y: 0, expected: null },
  { x: 3652, y: 2854, expected: null },
];

function formatId(id: number | null): string {
  return id === null ? "null" : String(id);
}

function statusLine(phase: string, step: string, progress: number, error: string | null): string {
  if (phase === "loading") {
    return "loading " + step + " " + Math.round(progress * 100) + "%";
  }
  if (phase === "failed") {
    return "failed: " + (error ?? "unknown error");
  }
  return phase;
}

function App() {
  // Reactivity is opt-in per component — without this call nothing below
  // re-renders when the load progresses.
  useSignals();

  const [probeX, setProbeX] = useState(598);
  const [probeY, setProbeY] = useState(391);

  useEffect(() => {
    // Never rejects; a failure lands in `loadError`.
    ensureMapLoaded();
  }, []);

  const phase = loadPhase.value;
  const ready = phase === "ready";

  useEffect(() => {
    if (!ready) {
      return;
    }
    // The task's stated done-condition is a log of the province id under a known
    // pixel. Logged once, when the load turns ready.
    for (const probe of PROBE_PIXELS) {
      console.info(
        "provinceAt(" +
          probe.x +
          ", " +
          probe.y +
          ") = " +
          formatId(provinceAt(probe.x, probe.y)) +
          " (expected " +
          formatId(probe.expected) +
          ")",
      );
    }
  }, [ready]);

  const assets = ready ? getMapAssets() : null;
  const size = mapSize.value;
  const probeId = ready ? provinceAt(probeX, probeY) : null;
  const probeProvince = probeId === null ? null : provinceById(probeId);

  return (
    <div className={styles.app}>
      <h1 className={styles.title}>Civitas Interactive Map</h1>

      <p className={styles.status} data-phase={phase}>
        {statusLine(phase, loadStep.value, loadProgress.value, loadError.value)}
      </p>

      {ready && size ? (
        <dl className={styles.facts}>
          <dt>map</dt>
          <dd>
            {size.width} x {size.height}
          </dd>
          <dt>provinces</dt>
          <dd>{provinceCount.value}</dd>
          <dt>colour index</dt>
          <dd>{assets ? assets.index.colorIndex.size : 0}</dd>
        </dl>
      ) : null}

      {ready ? (
        <table className={styles.probes}>
          <thead>
            <tr>
              <th>pixel</th>
              <th>expected</th>
              <th>provinceAt</th>
            </tr>
          </thead>
          <tbody>
            {PROBE_PIXELS.map((probe) => {
              const actual = provinceAt(probe.x, probe.y);
              const ok = actual === probe.expected;
              return (
                <tr key={probe.x + ":" + probe.y} data-ok={ok ? "yes" : "no"}>
                  <td>
                    ({probe.x}, {probe.y})
                  </td>
                  <td>{formatId(probe.expected)}</td>
                  <td>{formatId(actual)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      {ready ? (
        <div className={styles.lookup}>
          <label className={styles.lookupField}>
            x
            <input
              type="number"
              value={probeX}
              onChange={(event) => {
                setProbeX(Number(event.target.value));
              }}
            />
          </label>
          <label className={styles.lookupField}>
            y
            <input
              type="number"
              value={probeY}
              onChange={(event) => {
                setProbeY(Number(event.target.value));
              }}
            />
          </label>
          <span className={styles.lookupResult}>
            {formatId(probeId)}
            {probeProvince ? " — " + probeProvince.name : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export { App };
