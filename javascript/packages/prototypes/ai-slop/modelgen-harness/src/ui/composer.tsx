import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState } from "react";
import type { TabState } from "../../shared/types.js";
import {
  addAttachment,
  attachmentsByTab,
  cancel,
  messagesByTab,
  removeAttachment,
  send,
} from "../state/store.js";

/**
 * Where the description goes: a multi-line field, pictures dropped, pasted or
 * chosen, and the screenshots the viewer hands over. Cmd/Ctrl + Enter sends;
 * Enter alone is a new line.
 */
function Composer({ state }: { state: TabState }): React.JSX.Element {
  useSignals();
  const tabId = state.tab.id;
  const [text, setText] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachments = attachmentsByTab.value[tabId] ?? [];
  const firstMessage = (messagesByTab.value[tabId] ?? []).length === 0;
  const canSend = state.blender === "ready" && !state.running && text.trim().length > 0;

  useEffect(() => {
    const area = areaRef.current;
    if (!area) {
      return;
    }
    area.style.height = "0px";
    area.style.height = `${Math.min(Math.max(area.scrollHeight, 72), 280)}px`;
  }, [text]);

  const submit = () => {
    if (!canSend) {
      return;
    }
    const message = text;
    setText("");
    void send(tabId, message);
  };

  const takeFiles = (files: FileList | File[] | null) => {
    if (!files) {
      return;
    }
    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) {
        void addAttachment(tabId, file, file.name || "image.png");
      }
    }
  };

  return (
    <div
      className="composer"
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        takeFiles(event.dataTransfer.files);
      }}
    >
      {attachments.length > 0 ? (
        <div className="composer__attachments">
          {attachments.map((attachment) => {
            return (
              <div key={attachment.id} className="attachment" title={attachment.name}>
                <img src={attachment.url} alt={attachment.name} />
                <button
                  type="button"
                  className="attachment__remove"
                  title="Remove"
                  onClick={() => {
                    removeAttachment(tabId, attachment.id);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      <textarea
        ref={areaRef}
        className="composer__input"
        value={text}
        placeholder={
          firstMessage
            ? "Describe the model to build. What it is, its size, materials, purpose…"
            : "What should change? Cmd/Ctrl + Enter sends."
        }
        disabled={state.running}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onPaste={(event) => {
          const items = Array.from(event.clipboardData.items);
          const images = items.filter((item) => item.type.startsWith("image/"));
          if (images.length === 0) {
            return;
          }
          event.preventDefault();
          for (const item of images) {
            const file = item.getAsFile();
            if (file) {
              void addAttachment(tabId, file, "pasted.png");
            }
          }
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer__row">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            takeFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          className="button button--small"
          title="Attach pictures for the agent to work from"
          disabled={state.running}
          onClick={() => {
            fileRef.current?.click();
          }}
        >
          + image
        </button>
        <span className="composer__hint">
          {state.blender !== "ready" ? `Blender is ${state.blender}.` : "Cmd/Ctrl + Enter to send"}
        </span>
        {state.running ? (
          <button
            type="button"
            className="button button--small button--danger"
            onClick={() => {
              cancel(tabId);
            }}
          >
            Cancel run
          </button>
        ) : (
          <button type="button" className="button button--small button--primary" disabled={!canSend} onClick={submit}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}

export { Composer };
