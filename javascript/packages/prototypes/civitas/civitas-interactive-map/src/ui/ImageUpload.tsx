import { useEffect, useRef, useState } from "react";
import { downscaleImage } from "../state/image";
import type { ChangeEvent } from "react";
import styles from "./fields.module.css";

// A file picker that runs T05's `downscaleImage` and hands the parent a data
// URL. `downscaleImage` is the ONLY path an image takes into the store: this
// component never calls `toDataURL`, `FileReader` or `URL.createObjectURL`
// itself, which is what keeps the ~256 KB bound and the WebP-with-JPEG-fallback
// behaviour in one place.
//
// NO `useSignals()`: it reads no signal.

// A 200 MB TIFF must never reach `createImageBitmap`. The check is on the file,
// before anything is decoded.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

type ImageUploadProps = {
  label: string;
  value: string | null;
  maxEdge: number;
  onCommit: (dataUrl: string | null) => void;
  disabled?: boolean;
};

function ImageUpload(props: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // A counter, not a boolean: two picks in flight must not let the older one win.
  const requestRef = useRef(0);
  const mountedRef = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function onPick(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    // Cleared immediately, so picking the SAME file twice fires `change` both
    // times.
    event.target.value = "";
    if (!file) {
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        "that file is too large (" + Math.round(file.size / (1024 * 1024)) + " MB)",
      );
      return;
    }

    requestRef.current += 1;
    const id = requestRef.current;
    setBusy(true);
    setError(null);

    try {
      const dataUrl = await downscaleImage(file, props.maxEdge);
      if (id !== requestRef.current || !mountedRef.current) {
        return;
      }
      setBroken(false);
      setBusy(false);
      props.onCommit(dataUrl);
    } catch (failure) {
      if (id !== requestRef.current || !mountedRef.current) {
        return;
      }
      setBusy(false);
      // The previous value is KEPT. An unreadable pick must not destroy the
      // image that was already there.
      setError(failure instanceof Error ? failure.message : "the upload failed");
    }
  }

  function onRemove(): void {
    requestRef.current += 1;
    setBusy(false);
    setError(null);
    setBroken(false);
    props.onCommit(null);
  }

  const showImage = props.value !== null && props.value !== "" && !broken;

  return (
    <div className={styles.field}>
      <span className={styles.caption}>{props.label}</span>

      <div className={styles.upload}>
        <div className={styles.preview}>
          {showImage ? (
            <img
              className={styles.previewImage}
              alt={props.label}
              src={props.value ?? ""}
              // A stored data URL can be corrupt, and a broken-image glyph in a
              // parchment panel reads as a bug in the app.
              onError={() => {
                setBroken(true);
              }}
            />
          ) : (
            <span className={styles.previewEmpty}>no image</span>
          )}
        </div>

        <div className={styles.uploadActions}>
          <button
            className={styles.uploadButton}
            disabled={props.disabled === true || busy}
            type="button"
            onClick={() => {
              inputRef.current?.click();
            }}
          >
            {busy ? "working…" : "choose file…"}
          </button>
          {props.value === null || props.value === "" ? null : (
            <button
              className={styles.uploadButton}
              disabled={props.disabled === true}
              type="button"
              onClick={onRemove}
            >
              remove
            </button>
          )}
        </div>

        {error === null ? null : (
          <p className={styles.status} data-kind="error">
            {error}
          </p>
        )}

        <input
          className={styles.hiddenInput}
          accept="image/*"
          ref={inputRef}
          type="file"
          onChange={(event) => {
            void onPick(event);
          }}
        />
      </div>
    </div>
  );
}

export { ImageUpload, MAX_UPLOAD_BYTES, type ImageUploadProps };
