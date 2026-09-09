import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState } from "react";
import type { ReasoningEffort, TabState } from "../../shared/types.js";
import {
  addAttachment,
  attachmentsByTab,
  cancel,
  messagesByTab,
  removeAttachment,
  send,
  setTabAgent,
} from "../state/store.js";

/** What the Codex SDK takes, plus the empty default. */
const EFFORTS: ReasoningEffort[] = ["", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"];

/**
 * The models Codex recommends, from <https://learn.chatgpt.com/docs/models>.
 * The legacy ones are left out, but a tab that holds a slug missing from this
 * list keeps it and shows it: a model retired here, or one released after this
 * list was written, must not silently turn into something else.
 */
const MODELS: { slug: string; label: string }[] = [
  { slug: "", label: "model: default" },
  { slug: "gpt-6-astra", label: "Astra" },
  { slug: "gpt-5.6-sol", label: "5.6 Sol" },
  { slug: "gpt-5.6-terra", label: "5.6 Terra" },
  { slug: "gpt-5.6-luna", label: "5.6 Luna" },
  { slug: "gpt-5.3-codex-spark", label: "5.3 Codex Spark" },
];

function modelOptions(current: string): { slug: string; label: string }[] {
  if (current.length === 0 || MODELS.some((entry) => entry.slug === current)) {
    return MODELS;
  }
  return [...MODELS, { slug: current, label: `${current} (not listed)` }];
}

/**
 * Where the description goes: a multi-line field, pictures dropped, pasted or
 * chosen, and the screenshots the viewer hands over. Cmd/Ctrl + Enter sends;
 * Enter alone is a new line.
 *
 * The Codex model and effort sit here rather than in the settings, because
 * they belong to one file: each tab keeps its own, and the next run of that
 * tab uses them.
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
  const model = state.tab.agentModel;
  const effort = state.tab.reasoningEffort;

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
        <select
          className="composer__model"
          value={model}
          title="Codex model for this file. Default uses the model from ~/.codex/config.toml."
          disabled={state.running}
          onChange={(event) => {
            void setTabAgent(tabId, event.target.value, effort);
          }}
        >
          {modelOptions(model).map((entry) => {
            return (
              <option key={entry.slug} value={entry.slug}>
                {entry.label}
              </option>
            );
          })}
        </select>
        <select
          className="composer__effort"
          value={effort}
          title="Reasoning effort for this file. Empty uses the Codex default."
          disabled={state.running}
          onChange={(event) => {
            void setTabAgent(tabId, model, event.target.value as ReasoningEffort);
          }}
        >
          {EFFORTS.map((entry) => {
            return (
              <option key={entry} value={entry}>
                {entry === "" ? "effort: default" : `effort: ${entry}`}
              </option>
            );
          })}
        </select>
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
