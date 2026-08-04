import * as React from "react";
import { UiProvider, defaultKit } from "@ui";
import type { PaletteName, ThemeMode, UiKit } from "@ui";
import { kit as baseUiKit } from "../adapters/base-ui-kit";
import { kit as studioKit } from "../adapters/studio-kit";
import { App } from "../app/App";
import styles from "./harness.module.css";

/**
 * Demo chrome. Not part of the product, and deliberately built from plain HTML
 * instead of "@ui" — the switcher has to keep working while the kit under it
 * changes.
 *
 * Production wires one kit through the "@kit" alias and never imports the other.
 * This file imports both so a single `yarn dev` can show the swap. The same trick
 * is genuinely useful during a migration: run the new kit behind a flag for one
 * route, keep the old one everywhere else.
 */
const kits: UiKit[] = [baseUiKit, studioKit];

const palettes: Array<{ id: PaletteName; label: string }> = [
  { id: "default", label: "Default" },
  { id: "sunset", label: "Sunset" },
];

const modes: Array<{ id: ThemeMode; label: string }> = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

type SegmentProps<T extends string> = {
  legend: string;
  options: Array<{ id: T; label: string }>;
  value: T;
  onSelect: (next: T) => void;
};

function Segment<T extends string>({ legend, options, value, onSelect }: SegmentProps<T>) {
  return (
    <div className={styles.group}>
      <span className={styles.legend}>{legend}</span>
      <div className={styles.segment}>
        {options.map((option) => {
          const classes = [styles.seg];
          if (option.id === value) {
            classes.push(styles.segOn);
          }

          return (
            <button
              key={option.id}
              type="button"
              className={classes.join(" ")}
              aria-pressed={option.id === value}
              onClick={() => onSelect(option.id)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Harness() {
  const [kitId, setKitId] = React.useState(defaultKit.id);
  const [palette, setPalette] = React.useState<PaletteName>("default");
  const [mode, setMode] = React.useState<ThemeMode>("light");

  const kit = kits.find((candidate) => candidate.id === kitId) ?? defaultKit;

  return (
    <>
      <div className={styles.bar}>
        <div className={styles.brand}>
          <span className={styles.dot} />
          <span>ui-kit-wrapper</span>
        </div>
        <Segment
          legend="Kit"
          options={kits.map((candidate) => ({ id: candidate.id, label: candidate.label }))}
          value={kit.id}
          onSelect={setKitId}
        />
        <Segment legend="Palette" options={palettes} value={palette} onSelect={setPalette} />
        <Segment legend="Mode" options={modes} value={mode} onSelect={setMode} />
        <p className={styles.hint}>
          Kit changes the components. Palette and mode change only{" "}
          <code>src/ui/tokens.css</code>.
        </p>
      </div>

      <UiProvider kit={kit} palette={palette} mode={mode}>
        <App />
      </UiProvider>
    </>
  );
}

export { Harness as Shell };
