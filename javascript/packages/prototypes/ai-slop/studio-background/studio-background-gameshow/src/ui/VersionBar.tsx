import { useSignals } from "@preact/signals-react/runtime";
import { getEngine } from "../engine/engine";
import type { Conflict } from "../engine/sceneMerge";
import { MAX_VERSIONS } from "../engine/sceneSync";
import { conflicts, latestVersion, openVersion, sceneLive, syncNote, versionRemoved, versions } from "../state";
import styles from "./Editor.module.css";

// The versions of the scene (src/scene/versions/): which one is open, which one is the latest, a new version,
// and the conflicts between the edits of this tab and the file on disk.

function versionLabel(id: number, label: string | undefined, latest: number): string {
  return `v${id}${label ? ` · ${label}` : ""}${id === latest ? " (latest)" : ""}`;
}

function VersionBar() {
  useSignals();
  const engine = getEngine();
  const list = versions.value;
  const open = openVersion.value;
  const latest = latestVersion.value;
  const live = sceneLive.value;
  const full = list.length >= MAX_VERSIONS;
  const oldest = list.length > 0 ? list.reduce((a, b) => (a.id < b.id ? a : b)) : null;
  const dropNote = full && oldest ? ` The folder holds ${MAX_VERSIONS} versions: v${oldest.id} (the oldest) will be removed.` : "";
  return (
    <div className={styles.versionBar}>
      <span className={styles.versionTitle}>Version</span>
      <select
        className={styles.versionSelect}
        value={open}
        title="The version open in this tab. Save writes this version."
        onChange={(event) => {
          engine.sync.open(Number(event.target.value));
        }}
      >
        {versionRemoved.value ? <option value={open}>{`v${open} (removed)`}</option> : null}
        {list.map((item) => (
          <option key={item.id} value={item.id}>
            {versionLabel(item.id, item.label, latest)}
          </option>
        ))}
      </select>
      {versionRemoved.value ? (
        <span className={styles.versionAlert} data-marker="removed">
          {`v${open} was removed from disk. Save is off; make a new version to keep the edits.`}
        </span>
      ) : open !== latest ? (
        <span className={styles.versionAlert} data-marker="old">
          {`Old version: v${open} is open, the latest is v${latest}. Agents edit the latest.`}
        </span>
      ) : (
        <span className={styles.versionNote} data-marker="latest">Latest version</span>
      )}
      <button
        type="button"
        className={styles.toolButton}
        disabled={!live}
        title={`Copy the latest version (v${latest}) into a new version that becomes the latest.${dropNote}`}
        onClick={() => {
          if (full && oldest && !window.confirm(`A new version removes v${oldest.id}, the oldest of ${MAX_VERSIONS} versions. Go on?`)) {
            return;
          }
          void engine.sync.createVersion();
        }}
      >
        New version
      </button>
      {full && oldest ? <span className={styles.versionNote}>{`Next new version removes v${oldest.id}`}</span> : null}
      <span className={styles.versionSpacer} />
      {syncNote.value !== "" ? <span className={styles.versionSync}>{syncNote.value}</span> : null}
      <span className={live ? styles.versionNote : styles.versionAlert} title="The dev server sends the changes of the file on disk to this tab.">
        {live ? "Live: disk changes merge in" : "Read-only: no dev server"}
      </span>
    </div>
  );
}

function fieldList(conflict: Conflict): string {
  return conflict.fields.includes("*") ? "deleted on one side, changed on the other" : conflict.fields.join(", ");
}

function ConflictPanel() {
  useSignals();
  const list = conflicts.value;
  if (list.length === 0) {
    return null;
  }
  const sync = getEngine().sync;
  return (
    <div className={styles.conflictPanel}>
      <div className={styles.conflictHeader}>
        <span>{`${list.length} conflict${list.length === 1 ? "" : "s"}: this tab and the file on disk changed the same field. Save is off until each has a side.`}</span>
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => {
            sync.resolveAll("ours");
          }}
        >
          Keep all mine
        </button>
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => {
            sync.resolveAll("theirs");
          }}
        >
          Take all from disk
        </button>
      </div>
      {list.map((conflict) => (
        <div key={`${conflict.kind}:${conflict.key}`} className={styles.conflictRow} data-conflict={conflict.key}>
          <span className={styles.conflictName}>{conflict.kind === "object" ? conflict.key : `${conflict.kind} ${conflict.key}`}</span>
          <span className={styles.conflictFields}>{fieldList(conflict)}</span>
          <button
            type="button"
            className={styles.toolButton}
            title="Keep the value of this tab. The next Save writes it over the disk."
            onClick={() => {
              sync.resolve(conflict, "ours");
            }}
          >
            Keep mine
          </button>
          <button
            type="button"
            className={styles.toolButton}
            title="Take the value on disk into this tab."
            onClick={() => {
              sync.resolve(conflict, "theirs");
            }}
          >
            Take disk
          </button>
        </div>
      ))}
    </div>
  );
}

export { ConflictPanel, VersionBar };
