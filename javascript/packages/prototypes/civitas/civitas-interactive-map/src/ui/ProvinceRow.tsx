import { EditableText } from "./EditableText";
import { EditableTextArea } from "./EditableTextArea";
import { ImageUpload } from "./ImageUpload";
import { LORE_MAX, NAME_MAX, isImageDataUrl } from "../state/schema";
import { PROVINCE_IMAGE_MAX_EDGE } from "../state/image";
import { PROVINCE_LORE_ROWS, PROVINCE_ROW_HEIGHT } from "./province-list";
import { flushState, setProvinceImage, setProvinceLore, setProvinceName } from "../state/world-store";
import type { ImageNotice, ProvinceRow as ProvinceRowData } from "./province-list";
import styles from "./province-list.module.css";

// One row of the virtualised province list: a select strip, an image, a name and
// a lore box.
//
// NO `useSignals()`: this component reads no signal. The list holds the only
// subscription and hands a row plain props — the same rule `EditableText` and
// `ImageUpload` follow.
//
// THE ROW MUST WRITE NOTHING ON RENDER. Every setter call below sits inside a
// commit handler, which is what keeps `provinceOverrides` sparse across a
// several-hundred-row country: `writeOverrideField` already skips an unchanged
// value and deletes an override once its last field is emptied, and
// `useFieldCommit`'s unmount flush returns early when nothing was typed.
//
// The call site keys the row by the province id, so a sliding window unmounts
// the leaving id and mounts the entering one fresh. A buffered draft can then
// never be shown over, or committed into, a different province.

type ProvinceRowProps = {
  row: ProvinceRowData;
  selected: boolean;
  onSelect: (id: number) => void;
  onImageNotice: (notice: ImageNotice | null) => void;
};

function ProvinceRow(props: ProvinceRowProps) {
  const row = props.row;

  function onImage(dataUrl: string | null): void {
    if (dataUrl !== null && !isImageDataUrl(dataUrl)) {
      // `setProvinceImage` REJECTS SILENTLY — no return value, no warning, no
      // timer armed. Calling the store's own predicate first turns a silent drop
      // into a visible sentence without a read-back and without a `.peek()`.
      props.onImageNotice({ provinceId: row.id, rejected: true, touched: true });
      return;
    }
    setProvinceImage(row.id, dataUrl);
    // Resolves the quota outcome NOW instead of 400 ms later, which would read
    // as "it worked, then a banner appeared". Only on an image write or removal;
    // keystrokes stay on the debounce. The same rule T09 set for the flag.
    flushState();
    props.onImageNotice({ provinceId: row.id, rejected: false, touched: dataUrl !== null });
  }

  return (
    <li
      className={styles.row}
      data-known={row.known ? "true" : "false"}
      data-province-row={row.id}
      data-selected={props.selected ? "true" : "false"}
      // `PROVINCE_ROW_HEIGHT` is the single source of truth and it is applied
      // here, not in the CSS module, so the two cannot disagree.
      style={{ height: PROVINCE_ROW_HEIGHT }}
      // Typing in a field moves the map highlight to the province being edited.
      // `selectProvince` deduplicates through `sameSelection`, so a focus move
      // inside one row writes nothing.
      onFocusCapture={() => {
        props.onSelect(row.id);
      }}
    >
      <button
        className={styles.rowHead}
        type="button"
        onClick={() => {
          props.onSelect(row.id);
        }}
      >
        <span className={styles.rowName}>{row.name}</span>
        {row.edited ? (
          <span className={styles.rowDot} title="edited — stored in this browser" />
        ) : null}
        <span className={styles.rowId}>#{row.id}</span>
      </button>

      <div className={styles.rowBody}>
        {/* The short labels are load bearing: the image column is 136px and
            `.uploadActions` does not wrap, so `choose file…` beside `remove`
            overflows it while `change…` does not. No `hint`: the row is 196px
            tall and the panel footer carries the format once for the list. */}
        <ImageUpload
          chooseLabel="add…"
          label="Image"
          maxEdge={PROVINCE_IMAGE_MAX_EDGE}
          previewClassName={styles.rowPreview}
          replaceLabel="change…"
          value={row.imageDataUrl}
          onCommit={onImage}
        />

        <div className={styles.rowFields}>
          {/* `value` is the RAW override, not the resolved name. A controlled
              input has to let the user clear the field, and `setProvinceName("")`
              removes the override — which is exactly how a province returns to
              its manifest name. The resolved name shows as the placeholder and
              in the header strip. */}
          <EditableText
            label="Name"
            maxLength={NAME_MAX}
            placeholder={row.name}
            value={row.rawName}
            onCommit={(value) => {
              setProvinceName(row.id, value);
            }}
          />

          <EditableTextArea
            areaClassName={styles.rowArea}
            label="Lore"
            maxLength={LORE_MAX}
            placeholder="what happened here"
            rows={PROVINCE_LORE_ROWS}
            value={row.lore}
            onCommit={(value) => {
              setProvinceLore(row.id, value);
            }}
          />
        </div>
      </div>
    </li>
  );
}

export { ProvinceRow, type ProvinceRowProps };
