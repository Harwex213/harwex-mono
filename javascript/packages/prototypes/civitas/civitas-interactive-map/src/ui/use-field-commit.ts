import { useEffect, useRef, useState } from "react";

// The buffered-commit hook both text fields use. No JSX, no signals — it takes
// plain values and returns plain handlers.
//
// WHY DEBOUNCE AT ALL, when `markDirty` already batches the localStorage write
// at 400 ms: `updateCountry` replaces the countries array, which invalidates
// `countryById`, `countryOfProvince`, `countryTintWords`, `countryAggregates`
// and `countryLabelSources`, and re-runs `layoutCountryLabels` on the next
// frame. 200 ms turns a burst of twenty keystrokes into two of those.
//
// A FIXED WINDOW, not a restarting one — the same shape as `createStateWriter`
// in `persistence.ts`. A restarting debounce starves: continuous typing would
// postpone the write for as long as the user keeps typing.
//
// EVERY CALL SITE MUST PASS A `key` CONTAINING THE TARGET ID. Switching the
// selected country remounts the field and drops the draft. Without the key, a
// pending draft for country 3 is displayed over — and then committed into —
// country 4.

const FIELD_COMMIT_MS = 200;

type FieldCommit = {
  value: string;
  onChange: (next: string) => void;
  onBlur: () => void;
};

function useFieldCommit(
  value: string,
  commit: (next: string) => void,
  delayMs?: number,
): FieldCommit {
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<string | null>(null);
  const commitRef = useRef(commit);
  const delayRef = useRef(delayMs ?? FIELD_COMMIT_MS);

  // Assigned on EVERY render, so the unmount flush calls the current callback
  // and not the one captured on the first render. This is not optional:
  // `onCommit` is an arrow function in the parent's JSX and its identity changes
  // every render.
  commitRef.current = commit;
  delayRef.current = delayMs ?? FIELD_COMMIT_MS;

  function flush(): void {
    const pending = latest.current;
    latest.current = null;
    if (pending === null) {
      return;
    }
    commitRef.current(pending);
  }

  function onChange(next: string): void {
    setDraft(next);
    latest.current = next;
    if (timer.current !== null) {
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      flush();
      // The store write is synchronous, so `props.value` already holds the
      // committed text — or the CLAMPED text when it passed the cap, which then
      // visibly snaps. That is the correct feedback.
      setDraft(null);
    }, delayRef.current);
  }

  function onBlur(): void {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    flush();
    setDraft(null);
  }

  // The last keystroke must not be lost when the panel closes or the selection
  // moves. No dependency array entry: this runs at unmount only, and `flush`
  // reads its callback through `commitRef`.
  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      flush();
    };
  }, []);

  return { value: draft ?? value, onChange, onBlur };
}

export { FIELD_COMMIT_MS, useFieldCommit, type FieldCommit };
