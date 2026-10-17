import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { DEFAULT_EXCALIDRAW_STYLE, pickExcalidrawStyle } from "@hw/harwex-notes-protocol";
import { SettingsModal } from "./settings-modal";
import type { TJsonValue } from "@hw/harwex-notes-protocol";
import type { TSettingsModalRegistrySlice } from "./settings-modal.types";
import type { TDemo } from "../../../dev/demo";

const isOpen = signal(true);
const settings = signal<Readonly<Record<string, TJsonValue>>>({});

// A stand-in for the host store: the action writes the setting, and the modal reads the
// merged style back, as it does in the app.
const registry: TSettingsModalRegistrySlice = {
  setSettingAction: (key, value) => {
    const next = { ...settings.peek() };

    if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }

    settings.value = next;
  },
};

const Demo = () => {
  useSignals();

  const stored = settings.value["excalidraw.defaultStyle"];
  const drawingStyle = { ...DEFAULT_EXCALIDRAW_STYLE, ...pickExcalidrawStyle(stored) };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          onClick={() => {
            isOpen.value = true;
          }}
          type="button"
        >
          {"Open settings"}
        </button>
      </div>

      <pre style={{ margin: 0, fontSize: 12 }}>{JSON.stringify(settings.value, null, 2)}</pre>

      <SettingsModal
        drawingStyle={drawingStyle}
        isDrawingStyleCustom={stored !== undefined}
        isOpen={isOpen.value}
        onClose={() => {
          isOpen.value = false;
        }}
        registry={registry}
      />
    </div>
  );
};

const demo: TDemo = {
  title: "Settings modal",
  component: Demo,
};

export default demo;
