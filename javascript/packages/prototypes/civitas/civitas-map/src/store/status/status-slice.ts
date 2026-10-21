import { computed, signal } from "@preact/signals-react";

// What the editor is busy with, and the messages it shows.

function createStatusSlice() {
  const loading = signal(false);
  const exporting = signal(false);
  const detecting = signal(false);
  const error = signal<string | null>(null);
  // Non-fatal outcome of the last import or detection. An import can succeed and
  // still have something the operator needs to know — colours adopted, entries
  // skipped — and silently dropping that would make the editor disagree with
  // their file.
  const notice = signal<string | null>(null);

  const busy = computed(() => {
    return loading.value || exporting.value || detecting.value;
  });

  return { loading, exporting, detecting, busy, error, notice };
}

type TStatusSlice = ReturnType<typeof createStatusSlice>;

export {
  createStatusSlice,
  type TStatusSlice,
};
