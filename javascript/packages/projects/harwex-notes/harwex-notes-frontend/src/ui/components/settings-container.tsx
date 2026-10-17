import { useSignals } from "@preact/signals-react/runtime";
import { SettingsModal } from "@hw/harwex-notes-components";
import { EXCALIDRAW_DEFAULT_STYLE_SETTING } from "@hw/harwex-notes-protocol";
import { useEffect, useState } from "react";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TSetSettingAction } from "@hw/harwex-notes-protocol";

type TSettingsContainerRegistrySlice = {
  setSettingAction: TSetSettingAction;
};

type TSettingsContainerProps = {
  registry: TSettingsContainerRegistrySlice;
};

// The gear button and the settings modal behind it (SET-1). Cmd+, (Ctrl+, elsewhere)
// opens it as well, the usual settings chord on the Mac.
const SettingsContainer: FC<TSettingsContainerProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isChord = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
      if (!isChord || event.key !== ",") {
        return;
      }

      event.preventDefault();
      setIsOpen((open) => !open);
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <>
      <button
        aria-label={"Settings"}
        className="settings-button"
        onClick={() => setIsOpen(true)}
        title={"Settings (⌘,)"}
        type="button"
      >
        <svg aria-hidden={"true"} fill={"none"} focusable={"false"} viewBox={"0 0 16 16"}>
          <path
            d={"M6.7 1.5h2.6l.4 1.9 1.3.6 1.7-1 1.8 1.8-1 1.7.6 1.3 1.9.4v2.6l-1.9.4-.6 1.3 1 1.7-1.8 1.8-1.7-1-1.3.6-.4 1.9H6.7l-.4-1.9-1.3-.6-1.7 1-1.8-1.8 1-1.7-.6-1.3-1.9-.4V6.7l1.9-.4.6-1.3-1-1.7 1.8-1.8 1.7 1 1.3-.6z"}
            stroke={"currentColor"}
            strokeLinejoin={"round"}
            strokeWidth={"1.1"}
          />
          <circle cx={"8"} cy={"8"} r={"2.2"} stroke={"currentColor"} strokeWidth={"1.1"} />
        </svg>
      </button>

      <SettingsModal
        drawingStyle={store.derived.excalidrawDefaultStyle.value}
        isDrawingStyleCustom={store.session.settings.value[EXCALIDRAW_DEFAULT_STYLE_SETTING] !== undefined}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        registry={registry}
      />
    </>
  );
};

export { SettingsContainer };
